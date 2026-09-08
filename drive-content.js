(function () {
    const startedAt = Date.now();
    const timer = setInterval(() => {
        const control = document.getElementById('uc-download-link')
            || Array.from(document.querySelectorAll('a, button, input[type="submit"]'))
                .find(element => /download anyway|download/i.test(element.textContent || element.value || ''));

        if (control) {
            clearInterval(timer);
            console.log('[drive] Confirming download');
            control.click();
        } else if (Date.now() - startedAt > 30000) {
            clearInterval(timer);
            console.log('[drive] No confirmation page appeared; direct download may already be active');
        }
    }, 250);
})();
