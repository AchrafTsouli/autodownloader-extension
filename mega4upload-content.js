// mega4upload.net gate, confirmed from real page inspection: the file page
// has <button class="dl-btn dl-btn--free" name="method_free" value="Free
// Download">, which leads to a wait page with a "Verify you're human" check
// and a real countdown. That page embeds its own anti-bot note: a hidden
// human_proof value is computed by its own JS only once the countdown
// genuinely elapses, and the server rejects the download otherwise — so
// this does not try to shortcut the wait, it just waits for the site's own
// <button id="downloadbtn" class="dl-bigbtn downloadbtn"> to naturally gain
// the "is-ready" class (same timing a human would experience) and clicks
// it. chrome.downloads.onCreated (background.js) detects the resulting
// download; this script only drives the two clicks.
(function () {
    const timeoutMs = 150000;
    const pollMs = 500;
    const startedAt = Date.now();
    let clickedInitial = false;
    let verificationReported = false;

    function reportVerificationWait() {
        if (verificationReported) return;
        verificationReported = true;
        chrome.runtime.sendMessage({
            type: 'HOST_STATUS',
            host: 'mega4upload',
            status: 'waiting_for_verification',
            message: 'Complete the Cloudflare checkbox in the Mega4Upload tab'
        }).catch(() => {});
    }

    function findInitialButton() {
        return document.querySelector('button.dl-btn.dl-btn--free[name="method_free"]');
    }

    function findReadyButton() {
        const btn = document.getElementById('downloadbtn');
        return btn && btn.classList.contains('is-ready') ? btn : null;
    }

    const timer = setInterval(() => {
        const ready = findReadyButton();
        if (ready) {
            clearInterval(timer);
            console.log('[mega4upload] Download ready — clicking');
            ready.click();
            return;
        }

        if (!clickedInitial) {
            const initial = findInitialButton();
            if (initial) {
                console.log('[mega4upload] Clicking Free Download');
                initial.click();
                clickedInitial = true;
                // Cloudflare Turnstile requires a genuine user action. Keep
                // the queue alive and expose this state in the popup; after
                // verification, the normal is-ready detection below resumes.
                setTimeout(reportVerificationWait, 1000);
            }
        }

        if (Date.now() - startedAt > timeoutMs) {
            clearInterval(timer);
            console.warn('[mega4upload] Timed out waiting for the download to become ready');
        }
    }, pollMs);
})();
