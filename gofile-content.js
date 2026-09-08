(function () {
    const startedAt = Date.now();
    const timer = setInterval(() => {
        const candidates = Array.from(document.querySelectorAll('a[download], a, button'));
        const control = candidates.find(element =>
            element.offsetParent !== null
            && /download/i.test(
                element.textContent
                || element.getAttribute('aria-label')
                || element.getAttribute('title')
                || ''
            )
        );
        if (control) {
            clearInterval(timer);
            console.log('[gofile] Starting download');
            control.click();
        } else if (Date.now() - startedAt > 30000) {
            clearInterval(timer);
            console.warn('[gofile] Download control was not found');
        }
    }, 500);
})();
