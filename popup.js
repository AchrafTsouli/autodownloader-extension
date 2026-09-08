let pageData = null;
let currentJob = null;

const $ = id => document.getElementById(id);

async function inspectCurrentPage(tabId) {
    const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async () => {
            const episodeLinks = Array.from(document.querySelectorAll('a[onclick*="openEpisode"]'));
            const episodes = episodeLinks.map(link => {
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

            if (!episodes.length) return null;
            try {
                const response = await fetch(episodes[0].url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const documentCopy = new DOMParser().parseFromString(await response.text(), 'text/html');
                const hosts = new Set();
                const qualities = new Set();
                const aliases = {
                    'google drive': 'drive',
                    'mega.nz': 'mega',
                    'rf': 'kuhaku',
                    'rf.gd': 'kuhaku',
                    'kuhaku': 'kuhaku',
                    'wtsrv': 'wtsrv',
                    'wtsrv.xyz': 'wtsrv'
                };

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
                return { episodes, hosts: [...hosts], qualities: [...qualities] };
            } catch (error) {
                return { episodes, hosts: [], qualities: [], warning: error.message };
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
    data.hosts.forEach(item => host.add(new Option(hostDisplayName(item), item)));

    const numbers = data.episodes.map(item => item.number);
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    $('fromEp').min = min;
    $('fromEp').max = max;
    $('toEp').min = min;
    $('toEp').max = max;
    $('fromEp').placeholder = String(min);
    $('toEp').placeholder = String(max);
    $('hint').textContent = `${data.episodes.length} episodes found (${min}–${max}).`;
    $('startBtn').disabled = false;
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
        ['completed', 'failed', 'cancelled', 'manual_action_required', 'external_handoff'].includes(item.status)
    );
    const completed = job.results.filter(item =>
        ['completed', 'external_handoff'].includes(item.status)
    ).length;
    const failed = job.results.filter(item => item.status === 'failed').length;
    const active = job.results.filter(item =>
        !['completed', 'failed', 'cancelled', 'manual_action_required', 'external_handoff'].includes(item.status)
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
        && !['completed', 'failed', 'cancelled', 'external_handoff'].includes(item.status)
    );
    $('status').textContent = currentRecord?.hostMessage
        || job.abortReason
        || (job.currentEpisode
            ? `Processing episode ${job.currentEpisode}`
            : `${completed} completed, ${failed} failed`);
    $('stopBtn').disabled = !['queued', 'running', 'stopping'].includes(job.status);
    $('retryBtn').disabled = failed === 0 || ['queued', 'running', 'stopping'].includes(job.status);
}

$('episodeMode').addEventListener('change', () => {
    const mode = $('episodeMode').value;
    $('rangeFields').hidden = mode === 'all';
    $('toField').hidden = mode === 'single';
});

$('startBtn').addEventListener('click', async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const response = await chrome.runtime.sendMessage({
            type: 'START_JOB',
            sourceTabId: tab.id,
            episodes: selectedEpisodes(),
            options: {
                quality: $('quality').value,
                host: $('host').value,
                fallbackMode: $('fallbackMode').value
            }
        });
        if (!response?.ok) throw new Error(response?.error || 'Could not start job');
        renderJob(response.job);
    } catch (error) {
        $('hint').textContent = error.message;
    }
});

$('stopBtn').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'STOP_JOB' }));
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

chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'JOB_UPDATED') renderJob(message.job);
});

(async function initialize() {
    const existing = await chrome.runtime.sendMessage({ type: 'GET_JOB' }).catch(() => null);
    if (
        existing?.job
        && (
            existing.job.results?.length
            || ['queued', 'running', 'stopping'].includes(existing.job.status)
        )
    ) {
        renderJob(existing.job);
        return;
    }
    await loadPageData();
})();
