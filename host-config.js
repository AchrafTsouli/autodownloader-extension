// Shared host detection + priority config used by anime-content.js (and,
// potentially, the popup later on).
//
// HOST_PRIORITY doubles as the automatic-support allowlist. Hosts returned by
// WitAnime that are not listed here remain visible in diagnostics but are not
// offered in the popup or selected automatically.

const HOST_ADAPTERS = Object.freeze({
    mediafire: { label: 'Mediafire', priority: 10, automatic: true, timeoutMs: 60000 },
    workupload: { label: 'Workupload', priority: 20, automatic: true, timeoutMs: 60000 },
    gofile: { label: 'Gofile', priority: 30, automatic: true, timeoutMs: 60000 },
    mp4upload: { label: 'Mp4upload', priority: 40, automatic: true, timeoutMs: 150000 },
    hexload: { label: 'Hexload', priority: 50, automatic: true, timeoutMs: 60000 },
    wtsrv: { label: 'WTSRV (redirect)', priority: 60, automatic: true, timeoutMs: 120000 },
    kuhaku: { label: 'Kuhaku (redirect)', priority: 70, automatic: true, timeoutMs: 180000 },
    mega: { label: 'Mega', priority: 80, automatic: true, timeoutMs: 600000 },
    mega4upload: { label: 'Mega4Upload', priority: 90, automatic: true, timeoutMs: 150000 },
    drive: { label: 'Google Drive', priority: 100, automatic: true, timeoutMs: 60000 },
    send: { label: 'Send (manual only)', priority: 999, automatic: false, manual: true, timeoutMs: 180000 }
});

const HOST_PRIORITY = Object.entries(HOST_ADAPTERS)
    .filter(([, adapter]) => adapter.automatic)
    .sort((a, b) => a[1].priority - b[1].priority)
    .map(([key]) => key);

// The site's download-page pills show human labels (e.g. "google drive")
// that don't match the canonical keys used elsewhere (HOST_PRIORITY,
// manifest.json content scripts). Map known variants to those canonical
// keys; anything unrecognized passes through as its own lowercase string.
const HOST_LABEL_ALIASES = {
    'google drive': 'drive',
    'mega.nz': 'mega',
    'rf': 'kuhaku',
    'rf.gd': 'kuhaku',
    'kuhaku': 'kuhaku',
    'wtsrv': 'wtsrv',
    'wtsrv.xyz': 'wtsrv',
    'send.now': 'send',
    'send': 'send',
};

function normalizeHostLabel(label) {
    const key = (label || '').trim().toLowerCase();
    return HOST_LABEL_ALIASES[key] || key;
}

function hostDisplayName(key) {
    return HOST_ADAPTERS[key]?.label
        || (key ? key.charAt(0).toUpperCase() + key.slice(1) : key);
}

function hostIsAutomatic(key) {
    return Boolean(HOST_ADAPTERS[key]?.automatic);
}

function hostTimeout(key) {
    return HOST_ADAPTERS[key]?.timeoutMs || 60000;
}

// Fallback only: used when a cache entry has no DOM-provided host label
// (e.g. the page markup changed). Prefer normalizeHostLabel() on the
// DOM-declared host name whenever it's available.
function detectHost(url) {
    try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        if (hostname.includes('mediafire')) return 'mediafire';
        if (hostname.includes('workupload')) return 'workupload';
        if (hostname.includes('mp4upload')) return 'mp4upload';
        if (hostname.includes('gofile')) return 'gofile';
        if (hostname.includes('hexload')) return 'hexload';
        if (hostname === 'kuhaku.rf.gd' || hostname.endsWith('.rf.gd')) return 'kuhaku';
        if (hostname === 'wtsrv.xyz' || hostname.endsWith('.wtsrv.xyz')) return 'wtsrv';
        if (hostname.includes('mega4upload')) return 'mega4upload';
        if (hostname.includes('mega.nz')) return 'mega';
        if (hostname.includes('drive.google')) return 'drive';
        if (hostname === 'send.now' || hostname.endsWith('.send.now')) return 'send';
        return hostname; // unknown host: keep visible instead of crashing/hiding it
    } catch (e) {
        return 'unknown';
    }
}
