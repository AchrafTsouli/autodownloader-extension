// wtsrv.xyz is a short countdown/redirect layer used before the actual
// Mediafire or Workupload page. Let its own timer finish; the final host's
// content script will automatically continue the download.
(function () {
    console.log('[wtsrv] Waiting for redirect to the final file host');
    chrome.runtime.sendMessage({
        type: 'HOST_STATUS',
        host: 'wtsrv',
        status: 'waiting_for_redirect',
        message: 'Waiting for the WTSRV countdown and final host redirect'
    }).catch(() => {});
})();
