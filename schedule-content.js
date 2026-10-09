// Capture the authenticated schedule the user is already viewing.
// Hidden list and grid sections both contain all weekdays.
(function () {
    try {
        const entries = parseWitAnimeSchedule(document.documentElement.outerHTML);
        chrome.runtime.sendMessage({type:'TRACKER_SCHEDULE_SYNC',entries}).catch(() => {});
    } catch (error) { console.info('[Anime Orbit]',error.message); }
})();
