(function () {
    const startedAt = Date.now();
    const timer = setInterval(() => {
        const button = document.getElementById('downloadButton');
        if (button) {
            clearInterval(timer);
            console.log('[mediafire] Starting download');
            button.click();
        } else if (Date.now() - startedAt > 30000) {
            clearInterval(timer);
            console.warn('[mediafire] Download button was not found');
        }
    }, 250);
})();
