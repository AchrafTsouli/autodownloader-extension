// Auto-click for mega.nz file links. Confirmed against two real DOM
// inspections of the same physical button — same classes/icon/position,
// but its data-simpletip attribute changes value ("Download" before
// preparing, "Save" once Mega has the file ready) — same pattern as the
// hidden trigger anchor: <a id="dllink" download="filename" href="blob:...">.
// So this doesn't click just once: it re-clicks the button whenever its
// state label changes, and separately watches #dllink until its href
// becomes a real blob: URL and clicks that directly too.
//
// Mega has to download the whole file into browser memory and decrypt it
// client-side before the blob link exists, which for large files (hundreds
// of MB) can legitimately take minutes on a normal connection — confirmed
// manually working, just slow. So the button-find phase has a short
// timeout (it's pure UI, appears fast), but the blob-wait phase gets a
// much longer one, with periodic progress logs so it's clear it's still
// working rather than stuck.
(function () {
    const findButtonTimeoutMs = 15000;
    const blobWaitTimeoutMs = 10 * 60 * 1000; // large files can take several minutes
    const pollMs = 500;
    const logEveryMs = 15000;
    const start = Date.now();
    let firstButtonSeenAt = null;
    let lastClickedState = null;
    let lastLog = 0;

    function findDownloadButton() {
        return document.querySelector('button[data-simpletip="Download"], button[data-simpletip="Save"]');
    }

    const timer = setInterval(() => {
        const elapsed = Date.now() - start;

        const dllink = document.getElementById('dllink');
        const href = dllink ? dllink.getAttribute('href') : null;
        if (href && href.startsWith('blob:')) {
            clearInterval(timer);
            console.log('[mega] File ready — triggering download...');
            dllink.click();
            // Don't auto-close: the download reads from an in-page blob,
            // so closing the tab too early could cut off large files
            // mid-save. Leave it open for the user to close once done.
            return;
        }

        const btn = findDownloadButton();
        if (btn) {
            if (firstButtonSeenAt === null) firstButtonSeenAt = elapsed;
            const state = btn.getAttribute('data-simpletip');
            if (state !== lastClickedState) {
                console.log(`[mega] Clicking download control (state: "${state}")...`);
                btn.click();
                lastClickedState = state;
            }
        } else if (firstButtonSeenAt === null && elapsed > findButtonTimeoutMs) {
            clearInterval(timer);
            console.warn('[mega] Could not find the Download button. Please click manually.');
            return;
        }

        if (elapsed > blobWaitTimeoutMs) {
            clearInterval(timer);
            console.warn('[mega] Timed out waiting for the file to finish preparing. Please check the tab manually.');
            return;
        }

        if (elapsed - lastLog > logEveryMs) {
            lastLog = elapsed;
            console.log(`[mega] Still waiting for Mega to prepare the file... (${Math.round(elapsed / 1000)}s)`);
        }
    }, pollMs);
})();
