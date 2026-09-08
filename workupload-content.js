// Best-effort auto-click for workupload.com. Selectors are a guess (workupload
// typically shows a countdown before revealing the real download button) —
// adjust these if they don't match the live page.
(function () {
    const timeoutMs = 10000;
    const pollMs = 500;
    const start = Date.now();

    function findDownloadControl() {
        const byId = document.getElementById('downloadButton');
        if (byId && !byId.disabled) return byId;

        const candidates = Array.from(document.querySelectorAll('a[download], button, a'));
        return candidates.find(el =>
            !el.disabled &&
            el.offsetParent !== null &&
            /download/i.test(el.textContent || '')
        ) || null;
    }

    const timer = setInterval(() => {
        const btn = findDownloadControl();
        if (btn) {
            clearInterval(timer);
            console.log('[workupload] Auto-clicking download button...');
            btn.click();
        } else if (Date.now() - start > timeoutMs) {
            clearInterval(timer);
            console.warn('[workupload] Could not find a download button automatically. Please click manually.');
        }
    }, pollMs);
})();
