// Runs in the episode page's MAIN world. The background worker injects this
// file, then calls window.autoDownloaderExtractEpisode().
(function () {
    function normalizeHostLabel(label) {
        const aliases = {
            'google drive': 'drive',
            'mega.nz': 'mega',
            'rf': 'kuhaku',
            'rf.gd': 'kuhaku',
            'kuhaku': 'kuhaku',
            'wtsrv': 'wtsrv',
            'wtsrv.xyz': 'wtsrv'
        };
        const key = (label || '').trim().toLowerCase();
        return aliases[key] || key;
    }

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
            if (hostname.includes('drive.google') || hostname.includes('drive.usercontent.google')) return 'drive';
            return hostname;
        } catch {
            return 'unknown';
        }
    }

    function extractIndexMeta(doc) {
        const meta = {};
        doc.querySelectorAll('.quality-list').forEach(list => {
            let quality = null;
            Array.from(list.children).forEach(li => {
                const link = li.querySelector('a.download-link[data-index]');
                if (!link) {
                    const text = li.textContent || '';
                    if (/FHD/i.test(text)) quality = 'FHD';
                    else if (/HD/i.test(text)) quality = 'HD';
                    else if (/SD/i.test(text)) quality = 'SD';
                    return;
                }

                const index = Number.parseInt(link.dataset.index, 10);
                const label = link.querySelector('.notice')?.textContent || '';
                if (Number.isInteger(index)) {
                    meta[index] = { quality, host: normalizeHostLabel(label) };
                }
            });
        });
        return meta;
    }

    function hexToBytes(value) {
        const bytes = new Uint8Array(value.length / 2);
        for (let i = 0; i < value.length; i += 2) {
            bytes[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
        }
        return bytes;
    }

    function decrypt(raw, secret) {
        const bytes = hexToBytes(raw);
        let output = '';
        for (let i = 0; i < bytes.length; i++) {
            output += String.fromCharCode(bytes[i] ^ secret.charCodeAt(i % secret.length));
        }
        return output;
    }

    window.autoDownloaderExtractEpisode = function () {
        // WitAnime's original format used _t.l + _s. The current cx2.js
        // format renamed those fields to _b.l + _x. Accept both so cached or
        // older episode pages continue to work as well.
        const countRaw = window._b?.l ?? window._t?.l;
        const sequences = Array.isArray(window._x) ? window._x : window._s;
        if (!window._m?.r || countRaw == null || !Array.isArray(sequences)) {
            throw new Error('Encryption variables are missing');
        }

        const secret = atob(window._m.r);
        const count = Number.parseInt(countRaw, 10);
        if (!Number.isInteger(count) || count < 1) {
            throw new Error('Encrypted download count is invalid');
        }
        const indexMeta = extractIndexMeta(document);
        const downloads = [];

        for (let index = 0; index < count; index++) {
            const chunks = window[`_p${index}`];
            const sequenceRaw = sequences[index];
            if (!Array.isArray(chunks) || typeof sequenceRaw !== 'string') {
                throw new Error(`Encrypted entry ${index} is incomplete`);
            }

            const sequence = JSON.parse(decrypt(sequenceRaw, secret));
            const decrypted = chunks.map(chunk => decrypt(chunk, secret));
            const arranged = [];
            sequence.forEach((destination, position) => {
                arranged[destination] = decrypted[position];
            });

            const url = arranged.join('');
            const meta = indexMeta[index] || {};
            downloads.push({
                index,
                url,
                quality: meta.quality || null,
                host: meta.host || detectHost(url),
                urlHost: detectHost(url)
            });
        }

        return {
            title: document.title,
            downloads
        };
    };

    // Some redirect URLs (notably wtsrv.xyz and kuhaku.rf.gd) are not valid
    // when navigated to directly. The site's own click handler combines the
    // selected data-index with its auth metadata before opening the redirect.
    // Reuse that native path when requested by the background queue.
    window.autoDownloaderOpenDownloadIndex = function (index) {
        const link = document.querySelector(`a.download-link[data-index="${index}"]`);
        if (!link) throw new Error(`Download button ${index} was not found`);
        link.click();
        return true;
    };
})();
