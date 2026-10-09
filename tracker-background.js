const WATCHLIST_KEY = 'animeOrbitWatchlist';
const SCHEDULE_KEY = 'animeOrbitWitAnimeSchedule';
async function scheduleCache() {
    const stored = (await chrome.storage.local.get(SCHEDULE_KEY))[SCHEDULE_KEY];
    if (stored) return stored;
    return {...WITANIME_SCHEDULE_SNAPSHOT,source:'saved WitAnime schedule',nextFetch:0};
}
function applySiteSchedule(item, cache) {
    // The website's own day is authoritative, including for older follows.
    delete item.broadcast;
    const day = cache.entries[item.url.replace(/\/$/,'')];
    item.siteReleaseDay = Number.isInteger(day) ? day : null;
    item.scheduleSource = 'WitAnime';
    item.scheduleCheckedAt = cache.capturedAt;
    item.scheduleError = item.siteReleaseDay === null ? 'This anime is not listed in WitAnime’s weekly schedule' : null;
}
async function refreshSiteSchedule(force = false) {
    let cache = await scheduleCache();
    if (!force && (cache.nextFetch || 0) > Date.now()) return cache;
    try {
        const response = await fetch('https://witanime.site/schedule', {credentials:'include',signal:AbortSignal.timeout(15000)});
        if (!response.ok) throw new Error(`Schedule HTTP ${response.status}`);
        const entries = parseWitAnimeSchedule(await response.text());
        cache = {entries,capturedAt:Date.now(),source:'WitAnime',nextFetch:Date.now()+21600000};
    } catch (error) {
        cache = {...cache,nextFetch:Date.now()+900000,refreshError:error.message};
    }
    await chrome.storage.local.set({[SCHEDULE_KEY]:cache});
    return cache;
}
async function resolveBroadcast(item) {
    applySiteSchedule(item, await refreshSiteSchedule());
}
function updateWatched(item, value) {
    const watched = Number(value);
    if (value === '' || value == null || !Number.isInteger(watched) || watched < 0 || watched > item.latest) {
        throw new Error(`Choose a watched episode from 0 to ${item.latest}`);
    }
    item.watchedEpisodes = availableEpisodes(item).filter(number => number <= watched);
    item.watched = item.watchedEpisodes.length;
}
let trackerLock = Promise.resolve();
function serializeTracker(action) {
    const result = trackerLock.then(action);
    trackerLock = result.catch(() => {});
    return result;
}
function validateAnimeUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'witanime.site'
        || !/^\/anime\/[^/]+\/?$/.test(url.pathname)) throw new Error('Open a WitAnime anime page to follow it');
    return url.origin + url.pathname.replace(/\/$/, '');
}
function episodeLinks(html, animeUrl) {
    const slug = new URL(animeUrl).pathname.split('/').pop();
    const episodes = new Map();
    for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
        try {
            const url = new URL(match[1].replace(/&amp;/g, '&'), animeUrl);
            const route = url.pathname.match(/^\/watch\/([^/]+)\/(\d+)\/?$/);
            if (url.origin === 'https://witanime.site' && route?.[1] === slug) {
                episodes.set(Number(route[2]), url.href);
            }
        } catch {}
    }
    return [...episodes].sort((a, b) => a[0] - b[0]);
}
async function watchlist() {
    const list = (await chrome.storage.local.get(WATCHLIST_KEY))[WATCHLIST_KEY] || [];
    list.forEach(migrateEpisodeProgress);
    return list;
}
async function checkTrackedAnime(item) {
    const response = await fetch(item.url, { credentials: 'include', signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
        if (response.status === 429) {
            const delay = Number(response.headers.get('Retry-After')) * 1000;
            item.nextCheck = Date.now() + Math.max(3600000, delay || 0);
        }
        throw new Error(`Website check failed (HTTP ${response.status})`);
    }
    const episodes = episodeLinks(await response.text(), item.url);
    if (!episodes.length) throw new Error('Episode list unavailable; keeping previous episode data');
    const latest = episodes.at(-1);
    const added = episodes.filter(([number]) => !item.knownEpisodes.includes(number));
    if (added.length) {
        await chrome.notifications.create(`orbit:${item.id}`, {
            type: 'basic', iconUrl: 'icon128.png', title: item.title,
            message: added.length === 1 ? `Episode ${added[0][0]} is available!` : `${added.length} new episodes available — latest: ${latest[0]}`
        });
    }
    item.knownEpisodes = episodes.map(([number]) => number);
    item.latest = latest[0];
    item.latestUrl = latest[1];
    item.checkedAt = Date.now();
    item.error = null;
}
async function trackerTick() {
    // Downloads take priority over catalogue polling and share site limits.
    const job = await getJob();
    if (job && ['queued', 'running', 'pausing', 'stopping'].includes(job.status)) return;
    // One due title per minute: avoid bursts and keep each worker task short.
    const list = await watchlist();
    const item = list.filter(entry => !entry.paused && (entry.nextCheck || 0) <= Date.now())
        .sort((a, b) => (a.nextCheck || 0) - (b.nextCheck || 0))[0];
    if (!item) return;
    item.nextCheck = Date.now() + 3600000;
    try { await checkTrackedAnime(item); }
    catch (error) { item.error = error.message; item.attemptedAt = Date.now(); }
    const cache = await refreshSiteSchedule();
    list.forEach(entry => applySiteSchedule(entry,cache));
    await chrome.storage.local.set({ [WATCHLIST_KEY]: list });
}
chrome.alarms.create('orbit-tracker', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'orbit-tracker') serializeTracker(trackerTick).catch(() => {});
});
chrome.notifications.onClicked.addListener(id => {
    if (!id.startsWith('orbit:')) return;
    watchlist().then(list => {
        const item = list.find(entry => `orbit:${entry.id}` === id);
        if (item) chrome.tabs.create({ url: item.latestUrl || item.url });
    });
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message.type?.startsWith('TRACKER_')) return;
    serializeTracker(async () => {
        const list = await watchlist();
        if (message.type === 'TRACKER_GET') {
            const cache = await scheduleCache();
            list.forEach(item => applySiteSchedule(item,cache));
            await chrome.storage.local.set({[WATCHLIST_KEY]:list});
            return {ok:true,list,schedule:cache};
        }
        if (message.type === 'TRACKER_SCHEDULE_SYNC') {
            const ownPopup = sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html');
            if (!ownPopup && !/^https:\/\/witanime\.site\//.test(sender.tab?.url || '')) throw new Error('Schedule sync requires a WitAnime tab');
            const entries = {};
            for (const [url,day] of Object.entries(message.entries || {})) {
                if (Number.isInteger(day) && day >= 0 && day <= 6) entries[validateAnimeUrl(url)] = day;
            }
            if (!Object.keys(entries).length) throw new Error('Empty schedule');
            const cache={entries,capturedAt:Date.now(),source:'WitAnime',nextFetch:Date.now()+21600000};
            await chrome.storage.local.set({[SCHEDULE_KEY]:cache});
            list.forEach(item => applySiteSchedule(item,cache));
            await chrome.storage.local.set({[WATCHLIST_KEY]:list});
            return {ok:true,list,schedule:cache};
        }
        if (message.type === 'TRACKER_FOLLOW') {
            const url = validateAnimeUrl(message.item.url);
            if (list.some(item => item.url === url)) throw new Error('This anime is already followed');
            if (!/^\d{4}$/.test(String(message.item.year)) || !['Winter', 'Spring', 'Summer', 'Fall'].includes(message.item.season)) {
                throw new Error('Choose a valid season and year');
            }
            const episodes = message.item.episodes.filter(Number.isInteger).filter(number => number > 0);
            if (!episodes.length) throw new Error('No episodes found to establish a notification baseline');
            const followed = { id: crypto.randomUUID(), url, title: String(message.item.title).slice(0, 150),
                poster: /^https:\/\/images\.witanime\.site\//.test(message.item.poster || '') ? message.item.poster : '',
                season: message.item.season, year: Number(message.item.year), knownEpisodes: episodes,
                latest: Math.max(...episodes), latestUrl: `${url.replace('/anime/', '/watch/')}/${Math.max(...episodes)}`, watched: 0, watchedEpisodes:[],
                description:String(message.item.description || '').slice(0,3000),notes:'',favorite:false,
                releaseDay:null, broadcast:null, scheduleCheckedAt:Date.now(),
                paused: false, checkedAt: Date.now(), nextCheck: Date.now() + 3600000 };
            try { await resolveBroadcast(followed); } catch (error) { followed.scheduleError = error.message; }
            list.push(followed);
        } else if (message.type === 'TRACKER_UPDATE') {
            const item = list.find(entry => entry.id === message.id);
            if (!item) throw new Error('Anime not found');
            if (message.action === 'remove') list.splice(list.indexOf(item), 1);
            else if (message.action === 'pause') item.paused = !item.paused;
            else if (message.action === 'watched') updateWatched(item, message.watched);
            else if (message.action === 'episode_toggle') {
                if (!availableEpisodes(item).includes(message.episode)) throw new Error('Episode is not available');
                const watched = new Set(item.watchedEpisodes);
                if (watched.has(message.episode)) watched.delete(message.episode); else watched.add(message.episode);
                item.watchedEpisodes = [...watched].sort((a,b) => a-b);
                item.watched = item.watchedEpisodes.length;
            }
            else if (message.action === 'episodes_all') {
                item.watchedEpisodes = availableEpisodes(item); item.watched = item.watchedEpisodes.length;
            }
            else if (message.action === 'episodes_clear') { item.watchedEpisodes=[]; item.watched=0; }
            else if (message.action === 'episodes_set') {
                const available = availableEpisodes(item);
                if (!Array.isArray(message.episodes) || message.episodes.some(number => !available.includes(number))) throw new Error('Invalid watched episode selection');
                item.watchedEpisodes=[...new Set(message.episodes)].sort((a,b) => a-b); item.watched=item.watchedEpisodes.length;
            }
            else if (message.action === 'notes') item.notes=String(message.notes || '').slice(0,2000);
            else if (message.action === 'favorite') item.favorite=!item.favorite;
            else if (message.action === 'description') item.description=String(message.description || '').slice(0,3000);
            else if (message.action === 'schedule') {
                if (message.day === null) item.releaseDay = null;
                else if (Number.isInteger(message.day) && message.day >= 0 && message.day <= 6) item.releaseDay = message.day;
                else throw new Error('Choose a valid release weekday');
            }
            else if (message.action === 'schedule_lookup') {
                const cache = await refreshSiteSchedule(true);
                list.forEach(entry => applySiteSchedule(entry,cache));
            }
            else if (message.action === 'check') item.nextCheck = Date.now();
            else throw new Error('Unknown tracker action');
        } else throw new Error('Unknown tracker command');
        await chrome.storage.local.set({ [WATCHLIST_KEY]: list });
        return { ok: true, list };
    }).then(respond).catch(error => respond({ ok: false, error: error.message }));
    return true;
});
