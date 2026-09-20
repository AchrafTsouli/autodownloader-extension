let pageData = null;
let currentJob = null;
let savedPrefs = {};

const PREFS_KEY = 'autoDownloaderPrefs';

const $ = id => document.getElementById(id);

async function inspectCurrentPage(tabId) {
    const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async () => {
            const aliases = {
                'google drive': 'drive',
                'mega.nz': 'mega',
                'rf': 'kuhaku',
                'rf.gd': 'kuhaku',
                'kuhaku': 'kuhaku',
                'wtsrv': 'wtsrv',
                'wtsrv.xyz': 'wtsrv',
                'send.now': 'send',
                'send': 'send'
            };

            function modernEpisodes() {
                const groups = new Map();
                for (const link of document.querySelectorAll('a[href]')) {
                    try {
                        const url = new URL(link.href, location.href);
                        if (!/(^|\.)witanime\.site$/i.test(url.hostname)) continue;
                        const match = url.pathname.match(/^\/watch\/([^/]+)\/(\d+)\/?$/i);
                        if (!match) continue;
                        const slug = match[1];
                        const number = Number.parseInt(match[2], 10);
                        if (!groups.has(slug)) groups.set(slug, new Map());
                        groups.get(slug).set(number, { number, url: url.href });
                    } catch {}
                }

                const current = location.pathname.match(/^\/(?:anime|watch)\/([^/]+)/i)?.[1];
                const selected = current && groups.has(current)
                    ? groups.get(current)
                    : (groups.size === 1 ? groups.values().next().value : null);
                return selected ? [...selected.values()].sort((a, b) => a.number - b.number) : [];
            }

            function legacyEpisodes() {
                return Array.from(document.querySelectorAll('a[onclick*="openEpisode"]')).map(link => {
                    const encoded = (link.getAttribute('onclick') || '')
                        .match(/openEpisode\(['"]([^'"]+)['"]\)/)?.[1];
                    const number = Number.parseInt((link.textContent || '').match(/(\d+)/)?.[1], 10);
                    if (!encoded || !Number.isInteger(number)) return null;
                    try {
                        return { number, url: atob(encoded) };
                    } catch {
                        return null;
                    }
                }).filter(Boolean).sort((a, b) => a.number - b.number);
            }

            const modern = modernEpisodes();
            const episodes = modern.length ? modern : legacyEpisodes();

            if (!episodes.length) return null;
            try {
                const response = await fetch(episodes[0].url, { credentials: 'same-origin' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const documentCopy = new DOMParser().parseFromString(await response.text(), 'text/html');
                const hosts = new Set();
                const qualities = new Set();
                const versions = new Set();
                const languages = new Set();

                if (modern.length) {
                    const csrf = documentCopy.querySelector('meta[name="csrf-token"]')?.content;
                    if (!csrf) throw new Error('WitAnime CSRF token was not found');
                    const episodeUrl = new URL(episodes[0].url);
                    const sourceUrl = `${episodeUrl.pathname.replace(/\/$/, '')}/sources`;
                    const sourceResponse = await fetch(sourceUrl, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {
                            Accept: 'application/json',
                            'X-CSRF-TOKEN': csrf
                        }
                    });
                    if (!sourceResponse.ok) throw new Error(`Sources HTTP ${sourceResponse.status}`);
                    const manifest = await sourceResponse.json();
                    for (const [quality, entries] of Object.entries(manifest.downloads || {})) {
                        if (!Array.isArray(entries) || !entries.length) continue;
                        qualities.add(String(quality).toUpperCase());
                        entries.forEach(entry => {
                            const label = String(entry?.label || '').trim().toLowerCase();
                            if (label) hosts.add(aliases[label] || label);
                            if (entry?.version) versions.add(entry.version);
                            if (entry?.lang) languages.add(entry.lang);
                        });
                    }
                    return {
                        episodes,
                        hosts: [...hosts],
                        qualities: [...qualities],
                        versions: [...versions],
                        languages: [...languages],
                        siteVersion: 'modern'
                    };
                }

                documentCopy.querySelectorAll('.quality-list').forEach(list => {
                    Array.from(list.children).forEach(li => {
                        const link = li.querySelector('a.download-link');
                        if (link) {
                            const label = (link.querySelector('.notice')?.textContent || '').trim().toLowerCase();
                            if (label) hosts.add(aliases[label] || label);
                        } else {
                            const text = li.textContent || '';
                            if (/FHD/i.test(text)) qualities.add('FHD');
                            else if (/HD/i.test(text)) qualities.add('HD');
                            else if (/SD/i.test(text)) qualities.add('SD');
                        }
                    });
                });
                return {
                    episodes,
                    hosts: [...hosts],
                    qualities: [...qualities],
                    versions: [],
                    languages: [],
                    siteVersion: 'legacy'
                };
            } catch (error) {
                return {
                    episodes,
                    hosts: [],
                    qualities: [],
                    versions: [],
                    languages: [],
                    siteVersion: modern.length ? 'modern' : 'legacy',
                    warning: error.message
                };
            }
        }
    });
    return result || null;
}

function populateOptions(data) {
    const quality = $('quality');
    quality.innerHTML = '';
    const available = ['FHD', 'HD', 'SD'].filter(item => data.qualities.includes(item));
    (available.length ? available : ['FHD', 'HD', 'SD']).forEach(item => {
        quality.add(new Option(item, item));
    });

    const host = $('host');
    host.innerHTML = '';
    host.add(new Option('Auto', 'auto'));
    const supportedHosts = data.hosts.filter(item =>
        HOST_PRIORITY.includes(item) || HOST_ADAPTERS[item]?.manual
    );
    const automaticHosts = supportedHosts.filter(item => hostIsAutomatic(item));
    const manualHosts = supportedHosts.filter(item => HOST_ADAPTERS[item]?.manual);
    supportedHosts.forEach(item => host.add(new Option(hostDisplayName(item), item)));

    const version = $('version');
    version.innerHTML = '';
    version.add(new Option('Any', ''));
    (data.versions || []).forEach(item => {
        const label = item === 'sub' ? 'Subtitled' : (item === 'dub' ? 'Dubbed' : item);
        version.add(new Option(label, item));
    });

    const language = $('language');
    language.innerHTML = '';
    language.add(new Option('Any', ''));
    const languageNames = { jp: 'Japanese', ar: 'Arabic', en: 'English', kr: 'Korean', es: 'Spanish', cn: 'Chinese' };
    (data.languages || []).forEach(item => language.add(new Option(languageNames[item] || item, item)));

    $('hostOrder').value = savedPrefs.hostOrder || supportedHosts.join(', ');
    for (const id of ['quality', 'host', 'version', 'language', 'downloadManager', 'fallbackMode']) {
        const value = savedPrefs[id];
        if (value && [...$(id).options].some(option => option.value === value)) $(id).value = value;
    }
    if (host.value === 'auto' && !automaticHosts.length && manualHosts.length) {
        host.value = manualHosts[0];
    }

    const numbers = data.episodes.map(item => item.number);
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    $('fromEp').min = min;
    $('fromEp').max = max;
    $('toEp').min = min;
    $('toEp').max = max;
    $('fromEp').placeholder = String(min);
    $('toEp').placeholder = String(max);
    if (data.warning && data.siteVersion === 'modern') {
        $('hint').textContent = `Compatibility check failed: ${data.warning}`;
        $('startBtn').disabled = true;
    } else if (data.hosts.length && !supportedHosts.length) {
        $('hint').textContent = `${data.episodes.length} episodes found, but no supported download host is available.`;
        $('startBtn').disabled = true;
    } else {
        $('hint').textContent = `${data.episodes.length} episodes found (${min}–${max}).`
            + (manualHosts.length && !automaticHosts.length
                ? ' Only a manual host is available; verification will be required.'
                : '')
            + (data.warning ? ` Host check warning: ${data.warning}` : '');
        $('startBtn').disabled = false;
    }
}

function selectedEpisodes() {
    const mode = $('episodeMode').value;
    if (mode === 'all') return pageData.episodes;

    const from = Number.parseInt($('fromEp').value, 10);
    if (!Number.isInteger(from)) throw new Error('Enter an episode number');
    if (mode === 'single') {
        const episode = pageData.episodes.find(item => item.number === from);
        if (!episode) throw new Error(`Episode ${from} was not found`);
        return [episode];
    }

    const to = Number.parseInt($('toEp').value, 10);
    if (!Number.isInteger(to)) throw new Error('Enter both range values');
    if (from > to) throw new Error('"From" cannot be greater than "To"');
    const selected = pageData.episodes.filter(item => item.number >= from && item.number <= to);
    if (!selected.length) throw new Error('No episodes exist in that range');
    return selected;
}

function renderJob(job) {
    currentJob = job;
    if (!job) {
        $('setupPanel').style.display = '';
        $('progressPanel').style.display = 'none';
        return;
    }

    const visibleProgress = !['completed', 'cancelled'].includes(job.status) || job.results.length > 0;
    $('setupPanel').style.display = visibleProgress ? 'none' : '';
    $('progressPanel').style.display = visibleProgress ? 'block' : 'none';

    const terminal = job.results.filter(item =>
        ['completed', 'failed', 'cancelled', 'skipped', 'manual_action_required', 'external_handoff'].includes(item.status)
    );
    const completed = job.results.filter(item =>
        ['completed', 'external_handoff'].includes(item.status)
    ).length;
    const failed = job.results.filter(item => item.status === 'failed').length;
    const active = job.results.filter(item =>
        !['completed', 'failed', 'cancelled', 'skipped', 'manual_action_required', 'external_handoff'].includes(item.status)
    ).length;
    const total = job.episodes.length;

    $('jobState').textContent = job.status.replaceAll('_', ' ');
    $('progressText').textContent = `${terminal.length} / ${total}`;
    $('progressBar').style.width = `${total ? terminal.length / total * 100 : 0}%`;
    $('completedCount').textContent = completed;
    $('failedCount').textContent = failed;
    $('activeCount').textContent = active;
    const currentRecord = [...job.results].reverse().find(item =>
        item.episode === job.currentEpisode
        && !['completed', 'failed', 'cancelled', 'skipped', 'external_handoff'].includes(item.status)
    );
    $('status').textContent = currentRecord?.hostMessage
        || job.abortReason
        || (job.currentEpisode
            ? `Processing episode ${job.currentEpisode}`
            : `${completed} completed, ${failed} failed`);
    $('stopBtn').disabled = !['queued', 'running', 'pausing', 'paused', 'stopping'].includes(job.status);
    $('pauseBtn').disabled = !['queued', 'running'].includes(job.status);
    $('resumeBtn').disabled = job.status !== 'paused';
    $('skipBtn').disabled = !job.currentEpisode || !['running', 'pausing'].includes(job.status);
    $('retryBtn').disabled = failed === 0 || ['queued', 'running', 'pausing', 'stopping'].includes(job.status);

    const resultsByEpisode = new Map(job.results.map(item => [item.episode, item]));
    $('episodeResults').innerHTML = job.episodes.map(episode => {
        const item = resultsByEpisode.get(episode.number);
        const status = item?.status || (episode.number === job.currentEpisode ? 'active' : 'queued');
        const detail = item
            ? [item.actualHost, item.actualQuality, item.reason || item.hostMessage].filter(Boolean).join(' · ')
            : '';
        return `<div class="result-row"><strong>Episode ${escapeHtml(episode.number)}</strong><span>${escapeHtml(status)}${detail ? ` — ${escapeHtml(detail)}` : ''}</span></div>`;
    }).join('');
    updateElapsed();
}

function updateElapsed() {
    if (!currentJob?.createdAt) {
        $('elapsed').textContent = '';
        return;
    }
    const end = currentJob.finishedAt ? Date.parse(currentJob.finishedAt) : Date.now();
    const seconds = Math.max(0, Math.floor((end - Date.parse(currentJob.createdAt)) / 1000));
    $('elapsed').textContent = `Elapsed: ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

$('episodeMode').addEventListener('change', () => {
    const mode = $('episodeMode').value;
    $('rangeFields').hidden = mode === 'all';
    $('toField').hidden = mode === 'single';
});

$('startBtn').addEventListener('click', async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const hostPriority = [...new Set(
            $('hostOrder').value.split(',')
                .map(item => normalizeHostLabel(item))
                .filter(item => HOST_PRIORITY.includes(item))
        )];
        const preferences = {
            quality: $('quality').value,
            host: $('host').value,
            version: $('version').value,
            language: $('language').value,
            downloadManager: $('downloadManager').value,
            fallbackMode: $('fallbackMode').value,
            hostOrder: hostPriority.join(', ')
        };
        savedPrefs = preferences;
        await chrome.storage.local.set({ [PREFS_KEY]: preferences });
        const response = await chrome.runtime.sendMessage({
            type: 'START_JOB',
            sourceTabId: tab.id,
            episodes: selectedEpisodes(),
            options: {
                quality: $('quality').value,
                host: $('host').value,
                version: $('version').value || null,
                lang: $('language').value || null,
                downloadManager: $('downloadManager').value,
                fallbackMode: $('fallbackMode').value,
                hostPriority
            }
        });
        if (!response?.ok) throw new Error(response?.error || 'Could not start job');
        renderJob(response.job);
    } catch (error) {
        $('hint').textContent = error.message;
    }
});

$('stopBtn').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'STOP_JOB' }));
$('pauseBtn').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'PAUSE_JOB' }));
$('resumeBtn').addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ type: 'RESUME_JOB' });
    if (response?.ok) renderJob(response.job);
});
$('skipBtn').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'SKIP_CURRENT' }));
$('retryBtn').addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ type: 'RETRY_FAILED' });
    if (response?.ok) renderJob(response.job);
});
$('copyBtn').addEventListener('click', async () => {
    if (!currentJob) return;
    await navigator.clipboard.writeText(JSON.stringify(currentJob, null, 2));
    $('status').textContent = 'Report copied to clipboard';
});
async function loadPageData() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    pageData = await inspectCurrentPage(tab.id);
    if (!pageData) {
        $('hint').textContent = 'No WitAnime episode list was found on this page.';
        return;
    }
    populateOptions(pageData);
}

$('newBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_JOB' });
    currentJob = null;
    $('setupPanel').style.display = '';
    $('progressPanel').style.display = 'none';
    if (!pageData) await loadPageData();
});

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
}

async function loadHistory() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' }).catch(() => null);
    const history = response?.history || [];
    $('historyList').innerHTML = history.length
        ? history.map(item => {
            const completed = item.results?.filter(result =>
                ['completed', 'external_handoff'].includes(result.status)
            ).length || 0;
            const failed = item.results?.filter(result => result.status === 'failed').length || 0;
            return `<div class="history-item">${escapeHtml(new Date(item.createdAt).toLocaleString())} · ${completed}/${item.episodes?.length || 0} done${failed ? ` · ${failed} failed` : ''}</div>`;
        }).join('')
        : 'No job history yet.';
}

$('clearHistoryBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    await loadHistory();
});

chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'JOB_UPDATED') {
        renderJob(message.job);
        if (['completed', 'cancelled', 'failed'].includes(message.job.status)) loadHistory();
    }
});

(async function initialize() {
    savedPrefs = (await chrome.storage.local.get(PREFS_KEY))[PREFS_KEY] || {};
    await loadHistory();
    const existing = await chrome.runtime.sendMessage({ type: 'GET_JOB' }).catch(() => null);
    if (
        existing?.job
        && (
            existing.job.results?.length
            || ['queued', 'running', 'pausing', 'paused', 'stopping'].includes(existing.job.status)
        )
    ) {
        renderJob(existing.job);
        return;
    }
    await loadPageData();
})();

setInterval(updateElapsed, 1000);
