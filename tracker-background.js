const WATCHLIST_KEY = 'animeOrbitWatchlist';
const SCHEDULE_KEY = 'animeOrbitWitAnimeSchedule';
const ORBIT_SETTINGS_KEY = 'animeOrbitSettings';
const ORBIT_INBOX_KEY = 'animeOrbitInbox';
async function orbitSettings() {
    return validateOrbitSettings((await chrome.storage.local.get(ORBIT_SETTINGS_KEY))[ORBIT_SETTINGS_KEY]);
}
async function queueReleaseNotice(item, added) {
    const settings = await orbitSettings();
    const inbox = (await chrome.storage.local.get(ORBIT_INBOX_KEY))[ORBIT_INBOX_KEY] || [];
    const notice = {id:crypto.randomUUID(),animeId:item.id,title:item.title,episodes:added.map(([number]) => number),at:Date.now(),read:false,
        pending:item.notificationMode !== 'muted',mode:item.notificationMode || 'instant'};
    inbox.push(notice);
    if (notice.pending && notice.mode === 'instant' && !orbitQuietNow(settings)) {
        try {
            await chrome.notifications.create(`orbit:${item.id}`, {type:'basic',iconUrl:'icon128.png',title:item.title,
                message:`New episodes: ${notice.episodes.join(', ')}`});
            notice.pending = false;
        }catch(error) {notice.notificationError=error.message;}
    }
    await chrome.storage.local.set({[ORBIT_INBOX_KEY]:inbox.slice(-500)});
}
async function flushReleaseNotices() {
    const settings = await orbitSettings();
    if (orbitQuietNow(settings)) return;
    const inbox = (await chrome.storage.local.get(ORBIT_INBOX_KEY))[ORBIT_INBOX_KEY] || [];
    const pending = inbox.filter(n => n.pending && (n.mode !== 'digest' || Date.now()-n.at >= 86400000));
    if (!pending.length) return;
    try {
        await chrome.notifications.create('orbit:inbox', {type:'basic',iconUrl:'icon128.png',title:'Anime Orbit releases',
            message:`${pending.reduce((total,n) => total+n.episodes.length,0)} new episodes across ${new Set(pending.map(n => n.animeId)).size} anime. Open the notification inbox.`});
    }catch(error) {
        pending.forEach(n => {n.notificationError=error.message;});
        await chrome.storage.local.set({[ORBIT_INBOX_KEY]:inbox});return;
    }
    pending.forEach(n => {n.pending=false;});
    await chrome.storage.local.set({[ORBIT_INBOX_KEY]:inbox});
}
async function scheduleCache() {
    const stored = (await chrome.storage.local.get(SCHEDULE_KEY))[SCHEDULE_KEY];
    if (stored) return stored;
    return {...WITANIME_SCHEDULE_SNAPSHOT,source:'saved WitAnime schedule',nextFetch:0};
}
function applySiteSchedule(item, cache) {
    // The website's own day is authoritative, including for older follows.
    delete item.broadcast;
    const day = cache.entries[item.url.replace(/\/$/,'')];
    const previous=item.siteReleaseDay;
    item.siteReleaseDay = Number.isInteger(day) ? day : null;
    if(Number.isInteger(previous) && previous!==item.siteReleaseDay) {
        item.scheduleChanges=[...(item.scheduleChanges || []),{from:previous,to:item.siteReleaseDay,at:Date.now()}].slice(-30);
    }
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
    list.forEach(migrateLibraryItem);
    return list;
}
async function confirmBrowserEpisodeDownload(record) {
    if(!record.episodeUrl) return;
    const list=await watchlist();
    const item=list.find(i => `${i.url.replace('/anime/','/watch/')}/${record.episode}`===record.episodeUrl);
    if(!item || !availableEpisodes(item).includes(record.episode)) return;
    item.downloadedEpisodes=[...new Set([...item.downloadedEpisodes,record.episode])].sort((a,b) => a-b);
    await chrome.storage.local.set({[WATCHLIST_KEY]:list});
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
    const added = episodes.filter(([number]) => !item.knownEpisodes.includes(number));
    if (added.length) {
        await queueReleaseNotice(item,added);
    }
    // A partial response must not erase an already observed episode or the
    // watched progress attached to it when the library is next migrated.
    item.knownEpisodes = [...new Set([...item.knownEpisodes,...episodes.map(([number]) => number)])].sort((a,b) => a-b);
    item.latest = item.knownEpisodes.at(-1);
    item.latestUrl = episodes.find(([number]) => number === item.latest)?.[1]
        || item.latestUrl || `${item.url.replace('/anime/','/watch/')}/${item.latest}`;
    if(added.length) item.lastReleaseObservedAt=Date.now();
    item.checkedAt = Date.now();
    item.error = null;
    return added;
}
async function trackerTick() {
    await flushReleaseNotices();
    // Downloads take priority over catalogue polling and share site limits.
    const job = await getJob();
    if (job && ['queued', 'running', 'pausing', 'stopping'].includes(job.status)) return;
    // One due title per minute: avoid bursts and keep each worker task short.
    const list = await watchlist();
    const item = list.filter(entry => !entry.paused && !entry.archived && !['Dropped','Completed'].includes(entry.watchStatus) && (entry.nextCheck || 0) <= Date.now())
        .sort((a, b) => (a.nextCheck || 0) - (b.nextCheck || 0))[0];
    if (!item) return;
    item.nextCheck = Date.now() + 3600000;
    let added=[];
    try { added=await checkTrackedAnime(item); }
    catch (error) { item.error = error.message; item.attemptedAt = Date.now(); }
    const cache = await refreshSiteSchedule();
    list.forEach(entry => applySiteSchedule(entry,cache));
    await chrome.storage.local.set({ [WATCHLIST_KEY]: list });
    if(item.autoDownload && added.length) {
        try {
            const stored=await chrome.storage.local.get('autoDownloaderPrefs');
            const prefs=validateOrbitPreferences(stored.autoDownloaderPrefs);
            const candidates=added.filter(([n]) => !item.downloadedEpisodes.includes(n)).slice(0,item.autoDownloadLimit || 1);
            if(candidates.length) {
                await startDownloadJob({episodes:candidates.map(([number,url]) => ({number,url})),options:{quality:prefs.quality || 'FHD',host:prefs.host || 'auto',version:prefs.version || null,lang:prefs.language || null,
                    downloadManager:prefs.downloadManager || 'browser',fallbackMode:prefs.fallbackMode || 'fallback',hostPriority:(prefs.hostOrder || '').split(',').map(s => normalizeHostLabel(s.trim())).filter(s => HOST_PRIORITY.includes(s))}});
                item.autoDownloadMessage=`Queued newly discovered episodes ${candidates.map(([n]) => n).join(', ')}. ${Math.max(0,added.length-candidates.length)} not queued by limit/duplicate rules.`;
            }
        }catch(error) {item.autoDownloadMessage=`Automatic download not started: ${error.message}. Use manual download to retry.`;}
        await chrome.storage.local.set({[WATCHLIST_KEY]:list});
    }
}
chrome.alarms.create('orbit-tracker', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'orbit-tracker') serializeTracker(trackerTick).catch(() => {});
});
chrome.notifications.onClicked.addListener(id => {
    if (!id.startsWith('orbit:')) return;
    if (id === 'orbit:inbox') { chrome.tabs.create({url:chrome.runtime.getURL('popup.html?dashboard=1&inbox=1')}); return; }
    watchlist().then(list => {
        const item = list.find(entry => `orbit:${entry.id}` === id);
        if (item) chrome.tabs.create({ url: item.latestUrl || item.url });
    });
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message.type?.startsWith('TRACKER_')) return;
    serializeTracker(async () => {
        const list = await watchlist();
        if (message.type === 'TRACKER_LIBRARY') {
            if (sender.id !== chrome.runtime.id || sender.url?.split(/[?#]/)[0]!==chrome.runtime.getURL('popup.html')) throw new Error('Open Anime Orbit to manage library data');
            if (message.action === 'export') {
                const stored=await chrome.storage.local.get(['autoDownloaderPrefs','animeOrbitPresets']);
                return {ok:true,list,backup:{format:'anime-orbit',schema:1,exportedAt:Date.now(),list,settings:await orbitSettings(),preferences:validateOrbitPreferences(stored.autoDownloaderPrefs),presets:validateOrbitPresets(stored.animeOrbitPresets)}};
            }
            if (message.action === 'import') {
                const restored = validateOrbitBackup(message.backup);
                const prefs=await chrome.storage.local.get(['autoDownloaderPrefs','animeOrbitPresets']);
                const previous = {format:'anime-orbit',schema:1,list,settings:await orbitSettings(),preferences:prefs.autoDownloaderPrefs,presets:prefs.animeOrbitPresets};
                const merged = message.replace ? restored.list : [...list,...restored.list.filter(i => !list.some(old => old.url === i.url))];
                await chrome.storage.local.set({animeOrbitRecovery:previous,[WATCHLIST_KEY]:merged,[ORBIT_SETTINGS_KEY]:restored.settings,autoDownloaderPrefs:restored.preferences,animeOrbitPresets:restored.presets});
                return {ok:true,list:merged};
            }
            if (message.action === 'recover') {
                const recovery = (await chrome.storage.local.get('animeOrbitRecovery')).animeOrbitRecovery;
                if (!recovery) throw new Error('No recovery snapshot exists');
                const restored = validateOrbitBackup(recovery);
                await chrome.storage.local.set({[WATCHLIST_KEY]:restored.list,[ORBIT_SETTINGS_KEY]:restored.settings,autoDownloaderPrefs:restored.preferences,animeOrbitPresets:restored.presets});
                return {ok:true,list:restored.list};
            }
            if (message.action === 'settings') {
                await chrome.storage.local.set({[ORBIT_SETTINGS_KEY]:validateOrbitSettings(message.settings)});
                return {ok:true,list};
            }
            if (message.action === 'inbox') return {ok:true,list,inbox:(await chrome.storage.local.get(ORBIT_INBOX_KEY))[ORBIT_INBOX_KEY] || []};
            if (message.action === 'read') {
                const inbox = (await chrome.storage.local.get(ORBIT_INBOX_KEY))[ORBIT_INBOX_KEY] || [];
                inbox.forEach(n => {if (!message.id || n.id === message.id) {n.read=true;n.pending=false;}});
                await chrome.storage.local.set({[ORBIT_INBOX_KEY]:inbox});
                return {ok:true,list,inbox};
            }
            if (message.action === 'bulk') {
                if (!Array.isArray(message.ids) || !ORBIT_STATUSES.includes(message.status)) throw new Error('Choose a valid status');
                list.filter(i => message.ids.includes(i.id)).forEach(i => {i.watchStatus=message.status;});
                await chrome.storage.local.set({[WATCHLIST_KEY]:list});
                return {ok:true,list};
            }
            if (message.action === 'undo_remove') {
                const removed = (await chrome.storage.local.get('animeOrbitRemoved')).animeOrbitRemoved;
                if (!removed || list.some(i => i.url === removed.url)) throw new Error('No removed anime to restore');
                list.push(migrateLibraryItem(removed));
                await chrome.storage.local.set({[WATCHLIST_KEY]:list,animeOrbitRemoved:null});
                return {ok:true,list};
            }
            throw new Error('Unknown library action');
        }
        if (message.type === 'TRACKER_GET') {
            const cache = await scheduleCache();
            list.forEach(item => applySiteSchedule(item,cache));
            await chrome.storage.local.set({[WATCHLIST_KEY]:list});
            return {ok:true,list,schedule:cache};
        }
        if (message.type === 'TRACKER_SCHEDULE_SYNC') {
            const ownPopup = sender.id === chrome.runtime.id && sender.url?.split('?')[0] === chrome.runtime.getURL('popup.html');
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
            const before = [...item.watchedEpisodes];
            if (message.action === 'remove') {
                await chrome.storage.local.set({animeOrbitRemoved:item});
                list.splice(list.indexOf(item), 1);
            }
            else if (message.action === 'metadata') {
                if (!ORBIT_STATUSES.includes(message.status) || !Number.isInteger(message.rating) || message.rating < 0 || message.rating > 10
                    || !['instant','digest','muted'].includes(message.notificationMode)) throw new Error('Invalid anime preferences');
                if(message.minutes!==undefined && (!Number.isInteger(message.minutes) || message.minutes<1 || message.minutes>300)) throw new Error('Episode duration must be from 1 to 300 minutes');
                item.watchStatus=message.status; item.rating=message.rating; item.notificationMode=message.notificationMode;
                if(message.minutes!==undefined) {
                    item.episodeMinutes=message.minutes;
                }
                item.tags=String(message.tags || '').split(',').map(s => s.trim().slice(0,40)).filter(Boolean).slice(0,20);
                if(message.notificationMode==='muted') {
                    const inbox=(await chrome.storage.local.get(ORBIT_INBOX_KEY))[ORBIT_INBOX_KEY] || [];
                    inbox.filter(n => n.animeId===item.id).forEach(n => {n.pending=false;});
                    await chrome.storage.local.set({[ORBIT_INBOX_KEY]:inbox});
                }
            }
            else if (message.action === 'archive') item.archived=!item.archived;
            else if (message.action === 'auto_download') {
                if(typeof message.enabled!=='boolean' || !Number.isInteger(message.limit) || message.limit<1 || message.limit>5) throw new Error('Choose an automatic-download limit from 1 to 5');
                item.autoDownload=message.enabled;item.autoDownloadLimit=message.limit;
            }
            else if (message.action === 'rewatch') {
                item.rewatches.push({at:Date.now(),watchedEpisodes:[...item.watchedEpisodes]});
                item.rewatches=item.rewatches.slice(-50); item.watchStatus='Rewatching'; item.watchedEpisodes=[]; item.watched=0;
            }
            else if (message.action === 'episode_note') {
                if (!availableEpisodes(item).includes(message.episode)) throw new Error('Select an available episode');
                item.episodeNotes[message.episode]=String(message.note || '').slice(0,1000);
            }
            else if (message.action === 'episode_rating') {
                if(!availableEpisodes(item).includes(message.episode) || !Number.isInteger(message.rating) || message.rating<0 || message.rating>10) throw new Error('Choose an episode and a rating from 0 to 10');
                item.episodeRatings[message.episode]=message.rating;
            }
            else if (message.action === 'watch_date') {
                if(!availableEpisodes(item).includes(message.episode) || !Number.isFinite(message.at) || message.at<=0 || message.at>Date.now()) throw new Error('Choose a valid viewing date in the past');
                const event=[...item.watchHistory].reverse().find(e => e.episode===message.episode && e.watched);
                if(event) event.at=message.at;
                else if(item.watchedEpisodes.includes(message.episode)) item.watchHistory.push({episode:message.episode,watched:true,at:message.at});
                else throw new Error('Mark this episode watched before adding its viewing date');
                item.lastWatchedAt=Math.max(0,...item.watchHistory.map(e => e.at));
            }
            else if (message.action === 'downloaded') {
                if (!availableEpisodes(item).includes(message.episode)) throw new Error('Select an available episode');
                const downloaded=new Set(item.downloadedEpisodes);
                if(downloaded.has(message.episode)) downloaded.delete(message.episode); else downloaded.add(message.episode);
                item.downloadedEpisodes=[...downloaded].sort((a,b) => a-b);
            }
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
            if (['watched','episode_toggle','episodes_all','episodes_clear','episodes_set'].includes(message.action)) recordWatchChanges(item,before);
        } else throw new Error('Unknown tracker command');
        await chrome.storage.local.set({ [WATCHLIST_KEY]: list });
        return { ok: true, list };
    }).then(respond).catch(error => respond({ ok: false, error: error.message }));
    return true;
});
