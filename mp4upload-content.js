// Mp4upload commonly delays the real download control with a ~30 second
// countdown. Keep watching until the control becomes actionable instead of
// clicking an early placeholder and immediately stopping.
(function () {
    const timeoutMs = 120000;
    const pollMs = 500;
    const startedAt = Date.now();
    const lastClickedAt = new WeakMap();
    let freeFormSubmitted = false;

    function bypassFreeCountdown() {
        if (freeFormSubmitted) return false;

        const freeButton = document.querySelector(
            'input#method_free[name="method_free"], input.downloadbtn[value*="Free Download" i]'
        );
        if (!freeButton) return false;

        // Mp4upload's countdown only disables this submit input in the DOM.
        // Enable it immediately and submit its own form with the existing
        // hidden op/id/fname/referer fields intact.
        freeButton.removeAttribute('disabled');
        freeButton.disabled = false;
        freeButton.classList.remove('disabled');
        console.log('[mp4upload] Bypassing free-download countdown');

        const form = freeButton.form;
        if (form?.requestSubmit) {
            form.requestSubmit(freeButton);
        } else {
            freeButton.click();
        }
        freeFormSubmitted = true;
        return true;
    }

    function isVisible(element) {
        return element.offsetParent !== null;
    }

    function isActionable(element) {
        if (!isVisible(element) || element.disabled || element.getAttribute('aria-disabled') === 'true') {
            return false;
        }

        if (element.tagName === 'A') {
            const href = (element.getAttribute('href') || '').trim();
            if (!href || href === '#' || /^javascript:/i.test(href)) return false;
        }
        return true;
    }

    function findDownloadControl() {
        const preferred = [
            '#downloadButton',
            '#downloadbtn',
            'a[download]',
            'input[type="submit"][value*="download" i]',
            'button[name*="download" i]',
            'a[href*="download" i]'
        ];

        for (const selector of preferred) {
            const element = Array.from(document.querySelectorAll(selector)).find(isActionable);
            if (element) return element;
        }

        return Array.from(document.querySelectorAll('a, button, input[type="submit"]'))
            .find(element =>
                isActionable(element)
                && /download/i.test(
                    element.textContent
                    || element.value
                    || element.getAttribute('title')
                    || element.getAttribute('aria-label')
                    || ''
                )
            ) || null;
    }

    const timer = setInterval(() => {
        if (bypassFreeCountdown()) return;

        const control = findDownloadControl();
        if (control) {
            const lastClick = lastClickedAt.get(control) || 0;
            // Continue observing after a click: Mp4upload may replace or
            // activate a second control after the countdown/form submission.
            if (Date.now() - lastClick > 5000) {
                console.log('[mp4upload] Clicking active download control');
                control.click();
                lastClickedAt.set(control, Date.now());

                // Clicking a button is not proof that a download started.
                // The background queue advances only after downloads.onCreated
                // observes a real browser download. This prevents a changed or
                // blocked Mp4upload page from making the entire queue appear to
                // run successfully without downloading any files.
            }
        }

        if (Date.now() - startedAt > timeoutMs) {
            clearInterval(timer);
            console.warn('[mp4upload] Timed out waiting for the download to start');
        }
    }, pollMs);
})();
