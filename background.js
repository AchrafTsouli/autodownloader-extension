importScripts('host-config.js');

const STORAGE_KEY = 'autoDownloaderJob';
const HISTORY_KEY = 'autoDownloaderHistory';
const QUALITY_PRIORITY = ['FHD', 'HD', 'SD'];
const pendingDownloadTabs = new Map();
const cancellationWaiters = new Set();
let activeJob = null;
let running = false;
let stopRequested = false;
let pauseRequested = false;
let skipRequestedEpisode = null;
let keepAliveTimer = null;

// MV3 service workers can be terminated after ~30s with no extension-API
// activity, even mid-await on a setTimeout-based wait (e.g. mp4upload's
// 150s download-start timeout). That silently kills the whole in-flight
// job (pendingDownloadTabs, the processEpisode call) with no recovery.
// A cheap real API call every 20s resets Chrome's idle clock and keeps the
// worker alive for the whole duration a job is actually running.
function startKeepAlive() {
    if (keepAliveTimer) return;
    keepAliveTimer = setInterval(() => {
        chrome.runtime.getPlatformInfo(() => {});
    }, 20000);
}

function stopKeepAlive() {
    if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
    }
}

function now() {
    return new Date().toISOString();
}

function throwIfStopped() {
    if (stopRequested) throw new Error('Stopped by user');
}

function withCancellation(promise) {
    if (stopRequested) return Promise.reject(new Error('Stopped by user'));
    let rejectCancellation;
    const cancellation = new Promise((resolve, reject) => {
        rejectCancellation = reject;
        cancellationWaiters.add(reject);
    });
    return Promise.race([promise, cancellation]).finally(() => {
        cancellationWaiters.delete(rejectCancellation);
    });
}

async function getJob() {
    if (activeJob) return activeJob;
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    activeJob = stored[STORAGE_KEY] || null;
    return activeJob;
}

async function saveJob(job) {
    activeJob = job;
    job.updatedAt = now();
    await chrome.storage.local.set({ [STORAGE_KEY]: job });
    const completed = job.results.filter(item => item.status === 'completed').length;
    const failed = job.results.filter(item => item.status === 'failed').length;
    const terminal = completed + failed
        + job.results.filter(item =>
            ['cancelled', 'skipped', 'manual_action_required', 'external_handoff'].includes(item.status)
        ).length;
    await chrome.action.setBadgeBackgroundColor({ color: failed ? '#c62828' : '#1976d2' });
    await chrome.action.setBadgeText({
        text: ['running', 'queued', 'pausing', 'stopping'].includes(job.status)
            ? `${terminal}/${job.episodes.length}`
            : (failed ? String(failed) : '')
    });
    chrome.runtime.sendMessage({ type: 'JOB_UPDATED', job }).catch(() => {});
}

async function archiveJob(job) {
    const stored = await chrome.storage.local.get(HISTORY_KEY);
    const history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    const snapshot = JSON.parse(JSON.stringify(job));
    delete snapshot.sourceTabId;
    for (const result of snapshot.results || []) {
        delete result.episodeTabId;
        delete result.hostTabId;
        delete result.finalHostTabId;
        delete result.redirectTabId;
        delete result.relatedHostTabIds;
    }
    const next = [snapshot, ...history.filter(item => item.id !== job.id)].slice(0, 20);
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
}

function qualityOrder(requestedQuality, fallbackMode) {
    if (fallbackMode === 'strict') return [requestedQuality];
    if (fallbackMode === 'smallest') return ['SD', 'HD', 'FHD'];
    if (fallbackMode === 'lower') {
        const index = QUALITY_PRIORITY.indexOf(requestedQuality);
        return index === -1 ? [requestedQuality] : QUALITY_PRIORITY.slice(index);
    }
    return [requestedQuality, ...QUALITY_PRIORITY.filter(item => item !== requestedQuality)];
}

function buildDownloadChoices(downloads, options) {
    const requestedQuality = options.quality;
    const requestedHost = options.host;
    const supported = downloads.filter(item =>
        (hostIsAutomatic(item.host)
            || (item.host === requestedHost && HOST_ADAPTERS[item.host]?.manual))
        && (!options.version || item.version === options.version)
        && (!options.lang || item.lang === options.lang)
    );
    const configuredOrder = Array.isArray(options.hostPriority)
        ? options.hostPriority.filter(host => hostIsAutomatic(host))
        : [];
    const hostOrder = requestedHost !== 'auto' && options.fallbackMode === 'strict'
        ? [requestedHost]
        : [...new Set([
            ...(requestedHost !== 'auto' ? [requestedHost] : []),
            ...configuredOrder,
            ...HOST_PRIORITY
        ])];
    const choices = [];

    for (const quality of qualityOrder(requestedQuality, options.fallbackMode)) {
        const candidates = supported.filter(item => item.quality === quality);
        for (const host of hostOrder) {
            const item = candidates.find(candidate => candidate.host === host);
            if (!item) continue;
            choices.push({
                item,
                qualityFallback: quality !== requestedQuality,
                hostFallback: requestedHost !== 'auto' && host !== requestedHost
            });
        }
        if (options.fallbackMode === 'strict' && choices.length) break;
    }
    return choices;
}

function chooseDownload(downloads, requestedQuality, requestedHost, fallbackMode) {
    return buildDownloadChoices(downloads, {
        quality: requestedQuality,
        host: requestedHost,
        fallbackMode
    })[0] || null;
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => finish(new Error('Page load timed out')), timeoutMs);
        function listener(changedTabId, changeInfo) {
            if (changedTabId === tabId && changeInfo.status === 'complete') finish();
        }
        function finish(error) {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            error ? reject(error) : resolve();
        }
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.get(tabId).then(tab => {
            if (tab.status === 'complete') finish();
        }).catch(() => {});
    });
}

async function extractEpisode(tabId) {
    await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: ['anime-content.js']
    });
    const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => window.autoDownloaderExtractEpisode()
    });
    if (!result?.downloads?.length) throw new Error('No download links were extracted');
    return result;
}

async function prepareModernDownload(tabId, token) {
    const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: value => window.autoDownloaderPrepareDownload(value),
        args: [token]
    });
    if (typeof result !== 'string' || !/^https:\/\/witanime\.site\/watch\/download-gate\//i.test(result)) {
        throw new Error('WitAnime did not return a valid download gate');
    }
    return result;
}

function waitForDownloadStart(tabId, timeoutMs, metadata = {}) {
    return new Promise((resolve, reject) => {
        const tabIds = new Set([tabId]);
        function cleanup() {
            for (const id of tabIds) pendingDownloadTabs.delete(id);
        }
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Download did not start before timeout'));
        }, timeoutMs);
        const pending = {
            tabIds,
            ...metadata,
            resolve(item) {
                clearTimeout(timeout);
                const result = { ...item, relatedTabIds: [...tabIds] };
                cleanup();
                resolve(result);
            },
            reject(error) {
                clearTimeout(timeout);
                cleanup();
                reject(error);
            }
        };
        pendingDownloadTabs.set(tabId, pending);
    });
}

// Some redirect services open the final file host in a child tab rather than
// navigating in place. Associate that child with the same pending download.
chrome.tabs.onCreated.addListener(tab => {
    const pending = pendingDownloadTabs.get(tab.openerTabId);
    if (!pending || !tab.id) return;
    pending.tabIds.add(tab.id);
    pendingDownloadTabs.set(tab.id, pending);
});

chrome.downloads.onCreated.addListener(item => {
    let pending = pendingDownloadTabs.get(item.tabId);
    // Blob/data downloads can occasionally be reported without their source
    // tab. The queue permits only one pending host, so this fallback is safe.
    const uniquePending = new Set(pendingDownloadTabs.values());
    if (!pending && uniquePending.size === 1) {
        pending = uniquePending.values().next().value;
    }
    if (pending) pending.resolve(item);
});

chrome.downloads.onChanged.addListener(async delta => {
    if (!delta.state && !delta.error) return;
    const job = await getJob();
    if (!job) return;
    const record = job.results.find(result => result.downloadId === delta.id);
    if (!record) return;
    if (record.status === 'cancelled') return;

    if (delta.state?.current === 'complete') {
        record.status = 'completed';
        record.completedAt = now();
        if (record.hostTabId) chrome.tabs.remove(record.hostTabId).catch(() => {});
        if (record.finalHostTabId && record.finalHostTabId !== record.hostTabId) {
            chrome.tabs.remove(record.finalHostTabId).catch(() => {});
        }
        for (const tabId of record.relatedHostTabIds || []) {
            chrome.tabs.remove(tabId).catch(() => {});
        }
    } else if (delta.state?.current === 'interrupted' || delta.error) {
        const errorCode = delta.error?.current || 'Download interrupted';

        // IDM and similar managers take ownership by cancelling Chrome's
        // temporary download after it has been created. That appears as
        // USER_CANCELED even though the external download is healthy.
        if (errorCode === 'USER_CANCELED' && record.downloadStartedAt) {
            record.status = 'external_handoff';
            record.reason = 'Download handed to an external download manager';
            record.completedAt = now();
        } else {
            record.status = 'failed';
            record.reason = errorCode;
        }
    }
    await saveJob(job);
    await finishJobIfSettled(job);
});

async function finishJobIfSettled(job) {
    const terminal = job.results.filter(item =>
        ['completed', 'failed', 'cancelled', 'skipped', 'manual_action_required', 'external_handoff'].includes(item.status)
    );
    if (job.queueFinished && terminal.length === job.results.length) {
        job.status = stopRequested ? 'cancelled' : 'completed';
        job.finishedAt = now();
        await saveJob(job);
        await archiveJob(job);
        const completed = job.results.filter(item =>
            ['completed', 'external_handoff'].includes(item.status)
        ).length;
        const failed = job.results.filter(item => item.status === 'failed').length;
        await chrome.notifications.create(`autodownloader-${job.id}`, {
            type: 'basic',
            iconUrl: 'icon128.png',
            title: 'Auto Downloader finished',
            message: `${completed}/${job.results.length} completed${failed ? `, ${failed} failed` : ''}. Open the extension for the report.`
        });
    }
}

async function closeAttemptTabs(record, episodeTabId) {
    const tabs = new Set([
        record.hostTabId,
        record.finalHostTabId,
        record.redirectTabId,
        ...(record.relatedHostTabIds || [])
    ].filter(tabId => tabId && tabId !== episodeTabId));
    await Promise.all([...tabs].map(tabId => chrome.tabs.remove(tabId).catch(() => {})));
    record.hostTabId = null;
    record.finalHostTabId = null;
    record.redirectTabId = null;
    record.relatedHostTabIds = [];
}

async function attemptDownloadChoice(job, record, episodeTab, choice) {
    const routeHost = choice.item.urlHost || choice.item.host;
    const requiresManualAction = Boolean(HOST_ADAPTERS[routeHost]?.manual);
    const usesNativeSiteFlow = choice.item.flow !== 'witanime_api'
        && ['wtsrv', 'kuhaku'].includes(routeHost);
    const hostTab = usesNativeSiteFlow
        ? episodeTab
        : await chrome.tabs.create({ url: 'about:blank', active: requiresManualAction });

    record.actualQuality = choice.item.quality;
    record.actualHost = choice.item.host;
    record.version = choice.item.version || null;
    record.lang = choice.item.lang || null;
    record.routeHost = routeHost;
    record.qualityFallback = choice.qualityFallback;
    record.hostFallback = choice.hostFallback;
    record.hostTabId = hostTab.id;
    record.status = choice.item.flow === 'witanime_api' ? 'preparing_download' : 'waiting_for_download';
    await saveJob(job);

    const downloadStarted = waitForDownloadStart(hostTab.id, hostTimeout(routeHost), {
        host: routeHost,
        episode: record.episode,
        allowExternal: job.options.downloadManager === 'external'
    });

    try {
        if (choice.item.flow === 'witanime_api') {
            const gateUrl = await withCancellation(
                prepareModernDownload(episodeTab.id, choice.item.token)
            );
            record.status = 'waiting_for_download';
            await saveJob(job);
            await chrome.tabs.update(hostTab.id, { url: gateUrl });
            if (requiresManualAction) {
                record.status = 'waiting_for_verification';
                record.hostMessage = 'Complete the Send verification and click its download button.';
                await saveJob(job);
                await chrome.tabs.update(hostTab.id, { active: true }).catch(() => {});
                await chrome.notifications.create(`manual-${job.id}-${record.episode}`, {
                    type: 'basic',
                    iconUrl: 'icon128.png',
                    title: `Episode ${record.episode} needs your help`,
                    message: record.hostMessage,
                    priority: 2
                });
            }
        } else if (usesNativeSiteFlow) {
            await chrome.scripting.executeScript({
                target: { tabId: hostTab.id },
                world: 'MAIN',
                func: index => window.autoDownloaderOpenDownloadIndex(index),
                args: [choice.item.index]
            });
        } else {
            await chrome.tabs.update(hostTab.id, { url: choice.item.url });
        }
    } catch (error) {
        const pending = pendingDownloadTabs.get(hostTab.id);
        if (pending) pending.reject(error);
        await downloadStarted.catch(() => {});
        throw error;
    }

    const download = await withCancellation(downloadStarted);
    record.downloadId = download.id || null;
    record.filename = download.filename || null;
    record.finalHostTabId = download.tabId > 0 ? download.tabId : null;
    record.relatedHostTabIds = download.relatedTabIds || [hostTab.id];
    record.status = download.external ? 'external_handoff' : 'downloading';
    record.reason = download.external
        ? 'Final download control was handed to the configured external manager'
        : null;
    record.downloadStartedAt = now();

    const relatedTabs = await Promise.all(
        (record.relatedHostTabIds || []).map(tabId => chrome.tabs.get(tabId).catch(() => null))
    );
    const usesMegaBlob = String(download.url || '').startsWith('blob:')
        || relatedTabs.some(tab => {
            try {
                return /(^|\.)mega\.nz$/i.test(new URL(tab?.url || '').hostname);
            } catch {
                return false;
            }
        });

    if (!usesMegaBlob) {
        await closeAttemptTabs(record, usesNativeSiteFlow ? hostTab.id : episodeTab.id);
        record.hostTabClosedAt = now();
    }
    await saveJob(job);
    return { consumedEpisodeTab: usesNativeSiteFlow };
}

async function processEpisode(job, episode) {
    const record = {
        episode: episode.number,
        episodeUrl: episode.url,
        requestedQuality: job.options.quality,
        requestedHost: job.options.host,
        status: 'extracting',
        attempts: 1,
        startedAt: now()
    };
    job.results.push(record);
    await saveJob(job);

    let episodeTab;
    try {
        episodeTab = await chrome.tabs.create({ url: episode.url, active: false });
        record.episodeTabId = episodeTab.id;
        throwIfStopped();
        await withCancellation(waitForTabComplete(episodeTab.id));
        throwIfStopped();
        const extracted = await withCancellation(extractEpisode(episodeTab.id));
        throwIfStopped();
        let choices = buildDownloadChoices(extracted.downloads, job.options);
        if (!choices.length) throw new Error('Requested quality, language, version, or host is unavailable');

        record.attemptErrors = [];
        let refreshedSession = false;
        for (let index = 0; index < choices.length; index++) {
            const choice = choices[index];
            record.attempts = index + 1;
            record.status = 'opening_host';
            await saveJob(job);
            try {
                const outcome = await attemptDownloadChoice(job, record, episodeTab, choice);
                if (outcome.consumedEpisodeTab) episodeTab = null;
                return;
            } catch (error) {
                record.attemptErrors.push({
                    host: choice.item.host,
                    quality: choice.item.quality,
                    reason: error.message,
                    at: now()
                });
                await closeAttemptTabs(record, episodeTab?.id);

                const expired = /expired|HTTP (404|419)/i.test(error.message);
                if (choice.item.flow === 'witanime_api' && expired && !refreshedSession) {
                    refreshedSession = true;
                    await chrome.tabs.reload(episodeTab.id);
                    await withCancellation(waitForTabComplete(episodeTab.id));
                    const refreshed = await withCancellation(extractEpisode(episodeTab.id));
                    const replacement = buildDownloadChoices(refreshed.downloads, job.options)
                        .find(item => item.item.host === choice.item.host
                            && item.item.quality === choice.item.quality);
                    if (replacement) {
                        choices.splice(index + 1, 0, replacement);
                    }
                }
                if (stopRequested || skipRequestedEpisode === episode.number) throw error;
            }
        }
        const summary = record.attemptErrors
            .map(item => `${item.host}/${item.quality}: ${item.reason}`)
            .join('; ');
        throw new Error(`All supported hosts failed. ${summary}`);
    } catch (error) {
        const skipped = skipRequestedEpisode === episode.number;
        record.status = stopRequested ? 'cancelled' : (skipped ? 'skipped' : 'failed');
        record.reason = skipped ? 'Skipped by user' : error.message;
        record.completedAt = now();
        if (/Encryption variables|CSRF token|sources request|no downloadable sources|No download links/i.test(error.message)) {
            record.failureCode = 'site_changed';
        }
        if (record.hostTabId) chrome.tabs.remove(record.hostTabId).catch(() => {});
        if (record.redirectTabId && record.redirectTabId !== record.hostTabId) {
            chrome.tabs.remove(record.redirectTabId).catch(() => {});
        }
        await saveJob(job);
    } finally {
        if (skipRequestedEpisode === episode.number) skipRequestedEpisode = null;
        if (episodeTab?.id) chrome.tabs.remove(episodeTab.id).catch(() => {});
    }
}

async function runJob() {
    if (running) return;
    running = true;
    stopRequested = false;
    pauseRequested = false;
    startKeepAlive();
    try {
        const job = await getJob();
        if (!job || !['queued', 'running', 'pausing', 'stopping'].includes(job.status)) return;
        if (job.status === 'pausing') {
            job.status = 'paused';
            job.currentEpisode = null;
            await saveJob(job);
            return;
        }
        if (job.status === 'stopping') {
            job.status = 'cancelled';
            job.queueFinished = true;
            job.finishedAt = now();
            await saveJob(job);
            return;
        }
        if (job.status === 'running') {
            // Recover after a service-worker restart. Downloads already handed
            // to Chrome remain tracked; transient extraction/host steps retry.
            const transient = job.results.filter(item =>
                [
                    'extracting',
                    'opening_host',
                    'preparing_download',
                    'waiting_for_download',
                    'waiting_for_verification',
                    'waiting_for_redirect'
                ].includes(item.status)
            );
            for (const item of transient) {
                if (item.episodeTabId) chrome.tabs.remove(item.episodeTabId).catch(() => {});
                if (item.hostTabId) chrome.tabs.remove(item.hostTabId).catch(() => {});
                if (item.redirectTabId && item.redirectTabId !== item.hostTabId) {
                    chrome.tabs.remove(item.redirectTabId).catch(() => {});
                }
            }
            job.results = job.results.filter(item => !transient.includes(item));
            const processed = new Set(job.results.map(item => item.episode));
            const next = job.episodes.findIndex(item => !processed.has(item.number));
            job.nextIndex = next === -1 ? job.episodes.length : next;
        }
        job.status = 'running';
        await saveJob(job);

        for (let i = job.nextIndex; i < job.episodes.length; i++) {
            if (stopRequested) break;
            job.currentEpisode = job.episodes[i].number;
            job.nextIndex = i;
            await saveJob(job);
            await processEpisode(job, job.episodes[i]);
            job.nextIndex = i + 1;
            await saveJob(job);

            if (pauseRequested) {
                job.status = 'paused';
                job.currentEpisode = null;
                job.queueFinished = false;
                await saveJob(job);
                await archiveJob(job);
                return;
            }

            // A page/selector change usually breaks every episode in exactly
            // the same way. Do not burn through the full season after the
            // first failure; pause with the remaining episodes untouched so
            // the user can see the real error and retry after it is fixed.
            const latest = [...job.results].reverse().find(item =>
                item.episode === job.episodes[i].number
            );
            if (latest?.status === 'failed') {
                job.status = 'failed';
                job.currentEpisode = null;
                job.queueFinished = false;
                job.abortReason = `Queue paused after episode ${latest.episode}: ${latest.reason}`;
                await saveJob(job);
                await archiveJob(job);
                await chrome.notifications.create(`autodownloader-paused-${job.id}`, {
                    type: 'basic',
                    iconUrl: 'icon128.png',
                    title: latest.failureCode === 'site_changed'
                        ? 'WitAnime compatibility issue detected'
                        : 'Auto Downloader paused',
                    message: job.abortReason
                });
                return;
            }
        }

        job.queueFinished = true;
        job.currentEpisode = null;
        if (stopRequested) {
            job.status = 'cancelled';
            const recordedEpisodes = new Set(job.results.map(item => item.episode));
            for (let i = job.nextIndex; i < job.episodes.length; i++) {
                if (recordedEpisodes.has(job.episodes[i].number)) continue;
                job.results.push({
                    episode: job.episodes[i].number,
                    status: 'cancelled',
                    reason: 'Stopped by user'
                });
            }
            job.nextIndex = job.episodes.length;
        }
        await saveJob(job);
        await finishJobIfSettled(job);
    } finally {
        running = false;
        stopKeepAlive();
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if (message.type === 'START_JOB') {
            const existing = await getJob();
            if (existing && ['queued', 'running', 'pausing', 'paused', 'stopping'].includes(existing.status)) {
                sendResponse({ ok: false, error: 'A download job is already running' });
                return;
            }
            const job = {
                id: crypto.randomUUID(),
                status: 'queued',
                sourceTabId: message.sourceTabId,
                episodes: message.episodes,
                options: message.options,
                nextIndex: 0,
                currentEpisode: null,
                queueFinished: false,
                abortReason: null,
                finishedAt: null,
                results: [],
                createdAt: now(),
                updatedAt: now()
            };
            activeJob = job;
            await saveJob(job);
            runJob();
            sendResponse({ ok: true, job });
            return;
        }
        if (message.type === 'HOST_STATUS') {
            const job = await getJob();
            const tabId = sender.tab?.id;
            const record = job?.results.find(item =>
                item.hostTabId === tabId
                && !['completed', 'failed', 'cancelled', 'skipped', 'external_handoff'].includes(item.status)
            ) || job?.results.find(item =>
                item.episode === job.currentEpisode
                && ['waiting_for_download', 'waiting_for_redirect', 'waiting_for_verification'].includes(item.status)
            );
            if (record) {
                if (tabId && tabId !== record.hostTabId) record.redirectTabId = tabId;
                record.status = message.status || record.status;
                record.hostMessage = message.message || null;
                await saveJob(job);

                if (message.status === 'waiting_for_verification' && tabId) {
                    await chrome.tabs.update(tabId, { active: true }).catch(() => {});
                    if (sender.tab?.windowId) {
                        await chrome.windows.update(sender.tab.windowId, { focused: true }).catch(() => {});
                    }
                    await chrome.notifications.create(`verification-${job.id}-${record.episode}`, {
                        type: 'basic',
                        iconUrl: 'icon128.png',
                        title: `Episode ${record.episode} needs verification`,
                        message: 'Click the Cloudflare checkbox. The extension will handle the rest automatically.',
                        priority: 2
                    });
                }
            }
            sendResponse({ ok: Boolean(record) });
            return;
        }
        if (message.type === 'HOST_DOWNLOAD_TRIGGERED') {
            const job = await getJob();
            const tabId = sender.tab?.id;
            let pending = tabId ? pendingDownloadTabs.get(tabId) : null;
            const uniquePending = new Set(pendingDownloadTabs.values());
            if (!pending && uniquePending.size === 1) {
                pending = uniquePending.values().next().value;
            }
            const accepted = Boolean(
                pending?.allowExternal
                && job?.options?.downloadManager === 'external'
                && (!message.host || message.host === pending.host)
            );
            if (accepted) {
                pending.resolve({
                    id: null,
                    filename: null,
                    external: true,
                    host: pending.host,
                    url: sender.tab?.url || null
                });
            }
            sendResponse({ ok: accepted });
            return;
        }
        if (message.type === 'PAUSE_JOB') {
            const job = await getJob();
            if (!job || !['queued', 'running'].includes(job.status)) {
                sendResponse({ ok: false, error: 'No running job to pause' });
                return;
            }
            pauseRequested = true;
            job.status = 'pausing';
            await saveJob(job);
            sendResponse({ ok: true, job });
            return;
        }
        if (message.type === 'RESUME_JOB') {
            const job = await getJob();
            if (!job || job.status !== 'paused') {
                sendResponse({ ok: false, error: 'No paused job to resume' });
                return;
            }
            job.status = 'queued';
            job.abortReason = null;
            await saveJob(job);
            runJob();
            sendResponse({ ok: true, job });
            return;
        }
        if (message.type === 'SKIP_CURRENT') {
            const job = await getJob();
            if (!job?.currentEpisode || !['running', 'pausing'].includes(job.status)) {
                sendResponse({ ok: false, error: 'No active episode to skip' });
                return;
            }
            skipRequestedEpisode = job.currentEpisode;
            const skipError = new Error('Skipped by user');
            for (const reject of [...cancellationWaiters]) reject(skipError);
            for (const pending of new Set(pendingDownloadTabs.values())) pending.reject(skipError);
            sendResponse({ ok: true });
            return;
        }
        if (message.type === 'STOP_JOB') {
            stopRequested = true;
            const cancellationError = new Error('Stopped by user');
            for (const reject of [...cancellationWaiters]) {
                reject(cancellationError);
            }
            for (const pending of new Set(pendingDownloadTabs.values())) {
                pending.reject(cancellationError);
            }
            const job = await getJob();
            if (job) {
                const terminalStates = new Set([
                    'completed',
                    'failed',
                    'cancelled',
                    'skipped',
                    'manual_action_required',
                    'external_handoff'
                ]);
                for (const record of job.results) {
                    if (terminalStates.has(record.status)) continue;
                    if (record.episodeTabId) chrome.tabs.remove(record.episodeTabId).catch(() => {});
                    if (record.hostTabId) chrome.tabs.remove(record.hostTabId).catch(() => {});
                    if (record.redirectTabId && record.redirectTabId !== record.hostTabId) {
                        chrome.tabs.remove(record.redirectTabId).catch(() => {});
                    }
                    if (record.finalHostTabId && record.finalHostTabId !== record.hostTabId) {
                        chrome.tabs.remove(record.finalHostTabId).catch(() => {});
                    }
                    for (const tabId of record.relatedHostTabIds || []) {
                        chrome.tabs.remove(tabId).catch(() => {});
                    }
                    record.status = 'cancelled';
                    record.reason = 'Stopped by user';
                    record.completedAt = now();
                    if (record.downloadId) chrome.downloads.cancel(record.downloadId).catch(() => {});
                }

                const recordedEpisodes = new Set(job.results.map(item => item.episode));
                for (const episode of job.episodes) {
                    if (!recordedEpisodes.has(episode.number)) {
                        job.results.push({
                            episode: episode.number,
                            status: 'cancelled',
                            reason: 'Stopped by user',
                            completedAt: now()
                        });
                    }
                }

                job.nextIndex = job.episodes.length;
                job.currentEpisode = null;
                job.queueFinished = true;
                job.status = 'cancelled';
                job.finishedAt = now();
                await saveJob(job);
                await archiveJob(job);
            }
            sendResponse({ ok: true });
            return;
        }
        if (message.type === 'GET_JOB') {
            sendResponse({ ok: true, job: await getJob() });
            return;
        }
        if (message.type === 'GET_HISTORY') {
            const stored = await chrome.storage.local.get(HISTORY_KEY);
            sendResponse({ ok: true, history: stored[HISTORY_KEY] || [] });
            return;
        }
        if (message.type === 'CLEAR_HISTORY') {
            await chrome.storage.local.remove(HISTORY_KEY);
            sendResponse({ ok: true });
            return;
        }
        if (message.type === 'CLEAR_JOB') {
            const job = await getJob();
            if (job && ['queued', 'running', 'pausing', 'stopping'].includes(job.status)) {
                sendResponse({ ok: false, error: 'Stop the active job before clearing it' });
                return;
            }
            activeJob = null;
            await chrome.storage.local.remove(STORAGE_KEY);
            await chrome.action.setBadgeText({ text: '' });
            sendResponse({ ok: true });
            return;
        }
        if (message.type === 'RETRY_FAILED') {
            const oldJob = await getJob();
            const completedNumbers = new Set(
                oldJob?.results
                    .filter(item => ['completed', 'external_handoff', 'skipped'].includes(item.status))
                    .map(item => item.episode)
            );
            const retryEpisodes = oldJob?.episodes.filter(item => !completedNumbers.has(item.number)) || [];
            if (!oldJob || !retryEpisodes.length) {
                sendResponse({ ok: false, error: 'No failed episodes to retry' });
                return;
            }
            const job = {
                ...oldJob,
                id: crypto.randomUUID(),
                status: 'queued',
                episodes: retryEpisodes,
                nextIndex: 0,
                currentEpisode: null,
                queueFinished: false,
                abortReason: null,
                finishedAt: null,
                results: [],
                createdAt: now(),
                updatedAt: now()
            };
            activeJob = job;
            await saveJob(job);
            runJob();
            sendResponse({ ok: true, job });
        }
    })().catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
});

chrome.runtime.onStartup.addListener(() => runJob());
