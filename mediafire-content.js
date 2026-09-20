(function () {
    const startedAt = Date.now();
    const timer = setInterval(() => {
        const button = document.getElementById('downloadButton');
        if (button) {
            clearInterval(timer);
            console.log('[mediafire] Starting download');
            button.click();
            setTimeout(() => chrome.runtime.sendMessage({
                type: 'HOST_DOWNLOAD_TRIGGERED',
                host: 'mediafire'
            }).catch(() => {}), 4000);
        } else if (Date.now() - startedAt > 30000) {
            clearInterval(timer);
            console.warn('[mediafire] Download button was not found');
        }
    }, 250);
})();
