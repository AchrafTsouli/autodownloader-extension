// Shared MAIN-world request pacing, retained across episode tabs and reloads.
(function () {
    const key = 'autoDownloaderNextRequest';
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    window.autoDownloaderSiteSlot = async function () {
        const next = Math.max(Date.now(), Number(localStorage.getItem(key)) || 0);
        localStorage.setItem(key, String(next + 4000));
        await sleep(Math.max(0, next - Date.now()));
    };
    window.autoDownloaderSiteRequest = async function (url, options = {}) {
        for (let attempt = 0; attempt < 4; attempt++) {
            await window.autoDownloaderSiteSlot();
            const response = await fetch(url, options);
            if (response.status !== 429) return response;
            if (attempt === 3) throw new Error('WitAnime rate limit persists (HTTP 429); wait before retrying');
            const header = response.headers.get('Retry-After');
            const seconds = header && /^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : 0;
            const dateDelay = header && !seconds ? Date.parse(header) - Date.now() : 0;
            const delay = Math.max(15000 * 2 ** attempt, seconds, dateDelay || 0);
            localStorage.setItem(key, String(Math.max(Number(localStorage.getItem(key)) || 0, Date.now() + delay)));
        }
    };
})();
