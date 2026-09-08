// Shared host detection + priority config used by anime-content.js (and,
// potentially, the popup later on).
//
// New hosts the site starts using show up automatically (detectHost falls
// back to the raw hostname) even before we add a matching entry here or a
// dedicated content script for them.

const HOST_PRIORITY = ['mediafire', 'workupload', 'mp4upload', 'gofile', 'hexload', 'wtsrv', 'kuhaku', 'mega', 'mega4upload', 'drive'];

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
};

const HOST_DISPLAY_NAMES = {
    mediafire: 'Mediafire',
    workupload: 'Workupload',
    mp4upload: 'Mp4upload',
    gofile: 'Gofile',
    hexload: 'Hexload',
    kuhaku: 'Kuhaku (redirect)',
    wtsrv: 'WTSRV (redirect)',
    mega: 'Mega',
    mega4upload: 'Mega4Upload',
    drive: 'Google Drive',
};

function normalizeHostLabel(label) {
    const key = (label || '').trim().toLowerCase();
    return HOST_LABEL_ALIASES[key] || key;
}

function hostDisplayName(key) {
    return HOST_DISPLAY_NAMES[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : key);
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
        return hostname; // unknown host: keep visible instead of crashing/hiding it
    } catch (e) {
        return 'unknown';
    }
}
