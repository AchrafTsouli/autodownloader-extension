// Shared, deterministic library migrations and backup validation.
const ORBIT_STATUSES = ['Planning','Watching','On hold','Dropped','Completed','Rewatching'];
function migrateLibraryItem(item) {
    migrateEpisodeProgress(item);
    if (!ORBIT_STATUSES.includes(item.watchStatus)) item.watchStatus = 'Watching';
    if (!Array.isArray(item.tags)) item.tags = [];
    if (!Array.isArray(item.watchHistory)) item.watchHistory = [];
    if (!Array.isArray(item.rewatches)) item.rewatches = [];
    if (!item.episodeNotes || typeof item.episodeNotes !== 'object') item.episodeNotes = {};
    if (!item.episodeRatings || typeof item.episodeRatings !== 'object') item.episodeRatings = {};
    if (!Number.isInteger(item.episodeMinutes)) item.episodeMinutes = 24;
    if (!item.downloadedEpisodes || !Array.isArray(item.downloadedEpisodes)) item.downloadedEpisodes = [];
    if (!['instant','digest','muted'].includes(item.notificationMode)) item.notificationMode = 'instant';
    return item;
}
function recordWatchChanges(item, before, now = Date.now()) {
    migrateLibraryItem(item);
    const after = item.watchedEpisodes;
    for (const episode of new Set([...before,...after])) {
        if (before.includes(episode) !== after.includes(episode)) item.watchHistory.push({episode,watched:after.includes(episode),at:now});
    }
    item.watchHistory = item.watchHistory.slice(-2000);
    if (before.join(',') !== after.join(',')) item.lastWatchedAt = now;
}
function orbitQuietNow(settings, date = new Date()) {
    if (!settings.quietEnabled) return false;
    const hour = date.getHours();
    const start = settings.quietStart, end = settings.quietEnd;
    return start === end || (start < end ? hour >= start && hour < end : hour >= start || hour < end);
}
function validateOrbitSettings(value = {}) {
    if (!['dark','light'].includes(value.theme || 'dark') || !['comfortable','compact'].includes(value.density || 'comfortable')) throw new Error('Invalid appearance');
    const start = value.quietStart ?? 22, end = value.quietEnd ?? 8;
    if (![start,end].every(hour => Number.isInteger(hour) && hour >= 0 && hour <= 23)) throw new Error('Quiet hours must be from 0 to 23');
    return {theme:value.theme || 'dark',density:value.density || 'comfortable',quietEnabled:!!value.quietEnabled,quietStart:start,quietEnd:end,spoilerSafe:!!value.spoilerSafe};
}
function validateOrbitBackup(value) {
    if (value?.format !== 'anime-orbit' || value.schema !== 1 || !Array.isArray(value.list) || value.list.length > 2000) throw new Error('Unsupported Anime Orbit backup');
    const urls = new Set();
    const list = value.list.map(raw => {
        const url = new URL(raw.url);
        if (url.origin !== 'https://witanime.site' || !/^\/anime\/[^/]+\/?$/.test(url.pathname)) throw new Error('Backup contains an invalid anime URL');
        const canonical = url.origin + url.pathname.replace(/\/$/,'');
        if (urls.has(canonical)) throw new Error('Backup contains duplicate anime');
        urls.add(canonical);
        if (!ORBIT_STATUSES.includes(raw.watchStatus || 'Watching') || !['Winter','Spring','Summer','Fall'].includes(raw.season)
            || !Number.isInteger(raw.year) || raw.year < 1900 || raw.year > 2200) throw new Error('Backup contains invalid library metadata');
        if (!Array.isArray(raw.knownEpisodes) || raw.knownEpisodes.length > 10000 || raw.knownEpisodes.some(n => !Number.isInteger(n) || n < 1 || n > 100000)) throw new Error('Invalid episode list');
        const item = {id:crypto.randomUUID(),url:canonical,title:String(raw.title || 'Untitled').slice(0,150),
            season:raw.season,year:raw.year,knownEpisodes:[...new Set(raw.knownEpisodes)],watchedEpisodes:Array.isArray(raw.watchedEpisodes) ? raw.watchedEpisodes : [],
            description:String(raw.description || '').slice(0,3000),notes:String(raw.notes || '').slice(0,2000),favorite:!!raw.favorite,
            watchStatus:raw.watchStatus || 'Watching',rating:Number.isInteger(raw.rating) && raw.rating >= 0 && raw.rating <= 10 ? raw.rating : 0,
            tags:Array.isArray(raw.tags) ? raw.tags.slice(0,20).map(tag => String(tag).slice(0,40)) : [],
            notificationMode:['instant','digest','muted'].includes(raw.notificationMode) ? raw.notificationMode : 'instant',
            paused:!!raw.paused,archived:!!raw.archived,releaseDay:Number.isInteger(raw.releaseDay) && raw.releaseDay >= 0 && raw.releaseDay <= 6 ? raw.releaseDay : null,
            poster:/^https:\/\/images\.witanime\.site\//.test(raw.poster || '') ? raw.poster : '',
            watchHistory:[],rewatches:[],episodeNotes:{},downloadedEpisodes:[],nextCheck:Date.now()+3600000};
        item.episodeMinutes=Number.isInteger(raw.episodeMinutes) && raw.episodeMinutes>=1 && raw.episodeMinutes<=300 ? raw.episodeMinutes : 24;
        item.episodeRatings={};
        for(const [episode,rating] of Object.entries(raw.episodeRatings || {})) if(item.knownEpisodes.includes(Number(episode)) && Number.isInteger(rating) && rating>=0 && rating<=10) item.episodeRatings[episode]=rating;
        item.latest = Math.max(0,...item.knownEpisodes);
        item.latestUrl = `${canonical.replace('/anime/','/watch/')}/${item.latest}`;
        const history = entries => Array.isArray(entries) ? entries.slice(-2000).filter(e => Number.isInteger(e.episode) && item.knownEpisodes.includes(e.episode) && typeof e.watched === 'boolean' && Number.isFinite(e.at) && e.at > 0).map(e => ({episode:e.episode,watched:e.watched,at:e.at})) : [];
        item.watchHistory = history(raw.watchHistory);
        item.rewatches = Array.isArray(raw.rewatches) ? raw.rewatches.slice(-50).filter(r => Number.isFinite(r.at)).map(r => ({at:r.at,watchedEpisodes:Array.isArray(r.watchedEpisodes) ? r.watchedEpisodes.filter(n => item.knownEpisodes.includes(n)) : []})) : [];
        for (const [episode,note] of Object.entries(raw.episodeNotes || {}).slice(0,10000)) if (item.knownEpisodes.includes(Number(episode))) item.episodeNotes[episode] = String(note).slice(0,1000);
        item.downloadedEpisodes = Array.isArray(raw.downloadedEpisodes) ? [...new Set(raw.downloadedEpisodes.filter(n => item.knownEpisodes.includes(n)))] : [];
        item.lastWatchedAt = Number.isFinite(raw.lastWatchedAt) ? raw.lastWatchedAt : 0;
        return migrateLibraryItem(item);
    });
    return {list,settings:validateOrbitSettings(value.settings),preferences:validateOrbitPreferences(value.preferences),presets:validateOrbitPresets(value.presets)};
}
function validateOrbitPreferences(raw = {}) {
    const result={};
    const choices={quality:['4K','FHD','HD','SD'],downloadManager:['browser','external'],fallbackMode:['fallback','lower','smallest','strict']};
    for(const [key,allowed] of Object.entries(choices)) if(allowed.includes(raw[key])) result[key]=raw[key];
    for(const key of ['host','version','language','hostOrder']) if(typeof raw[key]==='string') result[key]=raw[key].slice(0,500);
    return result;
}
function validateOrbitPresets(raw = {}) {
    const result=Object.create(null);
    for(const [name,preferences] of Object.entries(raw).slice(0,25)) {
        if(!['__proto__','constructor','prototype'].includes(name) && name.length<=40 && preferences && typeof preferences==='object') result[name]=validateOrbitPreferences(preferences);
    }
    return result;
}
