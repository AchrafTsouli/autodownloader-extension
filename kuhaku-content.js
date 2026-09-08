// kuhaku.rf.gd is an intermediary timer/redirect page. It eventually
// navigates to a supported file host, whose own content script takes over.
(function () {
    console.log('[kuhaku] Waiting for redirect to the final file host');
    chrome.runtime.sendMessage({
        type: 'HOST_STATUS',
        host: 'kuhaku',
        status: 'waiting_for_redirect',
        message: 'Waiting for Kuhaku to redirect to the final host'
    }).catch(() => {});
})();
