const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function eventStub() {
    return { addListener() {}, removeListener() {} };
}

function testHostSelection() {
    const source = [
        fs.readFileSync(path.join(root, 'host-config.js'), 'utf8'),
        fs.readFileSync(path.join(root, 'background.js'), 'utf8'),
        'globalThis.testApi = { buildDownloadChoices, chooseDownload, qualityOrder };'
    ].join('\n');
    const sandbox = {
        console,
        URL,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        crypto: require('node:crypto').webcrypto,
        importScripts() {},
        chrome: {
            runtime: { onMessage: eventStub(), onStartup: eventStub(), sendMessage: async () => {} },
            tabs: { onCreated: eventStub(), onUpdated: eventStub() },
            downloads: { onCreated: eventStub(), onChanged: eventStub() },
            storage: { local: {} },
            action: {},
            notifications: {}
        }
    };
    vm.runInNewContext(source, sandbox, { filename: 'background.bundle.js' });
    const { buildDownloadChoices, qualityOrder } = sandbox.testApi;
    const downloads = [
        { quality: 'FHD', host: 'workupload' },
        { quality: 'FHD', host: 'mediafire' },
        { quality: 'HD', host: 'gofile' },
        { quality: 'HD', host: 'send' }
    ];

    assert.deepEqual([...qualityOrder('FHD', 'lower')], ['FHD', 'HD', 'SD']);
    assert.deepEqual([...qualityOrder('4K', 'lower')], ['4K', 'FHD', 'HD', 'SD']);
    assert.deepEqual([...qualityOrder('4K', 'smallest')], ['SD', 'HD', 'FHD', '4K']);
    assert.equal(buildDownloadChoices(downloads, {
        quality: 'FHD', host: 'workupload', fallbackMode: 'strict', hostPriority: []
    }).length, 1, 'strict mode must not silently switch hosts');
    assert.equal(buildDownloadChoices(downloads, {
        quality: 'FHD', host: 'auto', fallbackMode: 'fallback', hostPriority: ['workupload']
    })[0].item.host, 'workupload', 'custom host priority must win');
    assert.equal(buildDownloadChoices(downloads, {
        quality: 'HD', host: 'send', fallbackMode: 'strict', hostPriority: []
    })[0].item.host, 'send', 'manual Send must be selectable explicitly');
    assert.equal(buildDownloadChoices(downloads, {
        quality: 'HD', host: 'auto', fallbackMode: 'fallback', hostPriority: []
    }).some(choice => choice.item.host === 'send'), false, 'automatic mode must skip manual hosts');
}

function testExtensionReferences() {
    const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
    const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8') + fs.readFileSync(path.join(root,'tracker-popup.js'),'utf8') + fs.readFileSync(path.join(root,'anime-detail.js'),'utf8');
    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
    for (const match of popup.matchAll(/id="([^"]+)"/g)) ids.add(match[1]);
    const usedIds = [...popup.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
    const missingIds = [...new Set(usedIds.filter(id => !ids.has(id)))];
    assert.deepEqual(missingIds, [], `popup.js references missing elements: ${missingIds.join(', ')}`);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    for (const contentScript of manifest.content_scripts || []) {
        for (const filename of contentScript.js || []) {
            assert.equal(
                fs.existsSync(path.join(root, filename)),
                true,
                `manifest references missing script ${filename}`
            );
        }
    }
}

async function testModernExtraction() {
    const token = 'a'.repeat(64);
    const requests = [];
    const sandbox = {
        console,
        URL,
        TextEncoder,
        Uint8Array,
        atob: value => Buffer.from(value, 'base64').toString('binary'),
        crypto: require('node:crypto').webcrypto,
        location: {
            hostname: 'witanime.site',
            pathname: '/watch/example-anime/7',
            origin: 'https://witanime.site'
        },
        document: {
            title: 'Episode 7',
            querySelector(selector) {
                if (selector === 'meta[name="csrf-token"]') return { content: 'csrf-value' };
                return null;
            },
            querySelectorAll() { return []; }
        },
        fetch: async (url, options) => {
            requests.push({ url, options });
            return {
                ok: true,
                status: 200,
                async json() {
                    if (String(url).endsWith('/sources')) {
                        return { downloads: { hd: [
                            { token, label: 'MediaFire', version: 'sub', lang: 'ar' },
                            { token: 'bad-token', label: 'Gofile' }
                        ] } };
                    }
                    return {};
                }
            };
        },
        window: {}
    };
    sandbox.window.autoDownloaderSiteRequest = sandbox.fetch;
    sandbox.window.autoDownloaderSiteSlot = async () => {};
    vm.runInNewContext(
        fs.readFileSync(path.join(root, 'anime-content.js'), 'utf8'),
        sandbox,
        { filename: 'anime-content.js' }
    );

    const extracted = await sandbox.window.autoDownloaderExtractEpisode();
    assert.equal(extracted.flow, 'witanime_api');
    assert.equal(extracted.downloads.length, 1, 'invalid tokens must be ignored');
    assert.equal(extracted.downloads[0].host, 'mediafire');
    assert.equal(extracted.downloads[0].quality, 'HD');
    assert.equal(requests[0].url, '/watch/example-anime/7/sources');
    assert.equal(requests[0].options.headers['X-CSRF-TOKEN'], 'csrf-value');

    const gate = await sandbox.window.autoDownloaderPrepareDownload(token);
    assert.equal(gate, `https://witanime.site/watch/download-gate/${token}`);
    assert.equal(requests[1].url, `/watch/download-source/${token}`);
    sandbox.location.pathname = '/watch/movie/example-movie';
    await sandbox.window.autoDownloaderExtractEpisode();
    assert.equal(requests[2].url, '/watch/movie/example-movie/sources');
}

async function testRateLimits() {
    let time = 100000;
    let calls = 0;
    const storage = new Map();
    const sandbox = {
        window: {},
        Date: { now: () => time, parse: Date.parse },
        localStorage: {
            getItem: key => storage.get(key),
            setItem: (key, value) => storage.set(key, value)
        },
        setTimeout: (callback, delay) => { time += delay; callback(); },
        fetch: async () => {
            calls++;
            return { status: calls === 1 ? 429 : 200, headers: { get: () => '30' } };
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'site-request.js'), 'utf8'), sandbox);
    const result = await sandbox.window.autoDownloaderSiteRequest('/sources');
    assert.equal(result.status, 200);
    assert.equal(calls, 2);
    assert.ok(time >= 130000, 'Retry-After must delay the next request');
    const before = time;
    await sandbox.window.autoDownloaderSiteRequest('/next');
    assert.ok(time - before >= 4000, 'requests must remain paced after retries');
    sandbox.fetch = async () => ({ status: 429, headers: { get: () => null } });
    await assert.rejects(sandbox.window.autoDownloaderSiteRequest('/blocked'), /HTTP 429/);
}

async function testTracker() {
    let saved = [];
    let cachedSchedule;
    const notifications = [];
    let trackerHandler;
    const sandbox = {
        URL, Date, AbortSignal,
        crypto: require('node:crypto').webcrypto,
        getJob: async () => null,
        chrome: {
            storage: { local: { get: async () => ({animeOrbitWatchlist:saved,animeOrbitWitAnimeSchedule:cachedSchedule}), set: async data => {
                if (data.animeOrbitWatchlist) saved = data.animeOrbitWatchlist;
                if (data.animeOrbitWitAnimeSchedule) cachedSchedule = data.animeOrbitWitAnimeSchedule;
            } } },
            alarms: {create() {}, onAlarm:eventStub()},
            notifications: {onClicked:eventStub(), create:async (id, data) => {notifications.push(data);}},
            runtime: {id:'test-extension',getURL:path => `chrome-extension://test-extension/${path}`,onMessage:{addListener(handler) {trackerHandler=handler;}}}
        },
        fetch: async () => ({ok:true, text:async () => '<a href="/watch/example/1">1</a><a href="/watch/example/2">2</a><a href="/watch/other/99">99</a>'})
    };
    vm.runInNewContext(fs.readFileSync(path.join(root,'tracker-progress.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'witanime-schedule.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'tracker-background.js'),'utf8') + '\nglobalThis.api={episodeLinks,validateAnimeUrl,trackerTick,resolveBroadcast};', sandbox);
    assert.throws(() => sandbox.api.validateAnimeUrl('https://evil.example/anime/test'));
    const links = sandbox.api.episodeLinks('<a href="/watch/example/2">2</a><a href="https://evil.example/watch/example/3">3</a>', 'https://witanime.site/anime/example');
    assert.equal(links.length,1);
    saved = [{id:'test',title:'Example',url:'https://witanime.site/anime/example',knownEpisodes:[1],nextCheck:0}];
    await sandbox.api.trackerTick();
    assert.equal(notifications.length,1,'a newly discovered episode should notify');
    assert.equal(saved[0].latest,2);
    saved[0].nextCheck=0;
    await sandbox.api.trackerTick();
    assert.equal(notifications.length,1,'rechecking the same episode must not duplicate notifications');
    sandbox.fetch=async () => ({ok:false,status:403});
    saved[0].nextCheck=0;
    await sandbox.api.trackerTick();
    assert.equal(saved[0].latest,2,'a blocked page must preserve the episode baseline');
    assert.match(saved[0].error,/403/);
    const message = (body,sender={}) => new Promise(resolve => trackerHandler(body,sender,resolve));
    saved[0].latest=4;
    let response=await message({type:'TRACKER_UPDATE',id:'test',action:'watched',watched:2});
    assert.equal(response.ok,true);
    assert.equal(saved[0].watched,2,'partial progress must persist without marking every episode watched');
    response=await message({type:'TRACKER_UPDATE',id:'test',action:'watched',watched:5});
    assert.equal(response.ok,false);
    assert.equal(saved[0].watched,2,'invalid progress must preserve the existing value');
    await message({type:'TRACKER_UPDATE',id:'test',action:'watched',watched:0});
    assert.equal(saved[0].watched,0,'users must be able to correct progress downward');
    await message({type:'TRACKER_UPDATE',id:'test',action:'schedule',day:5});
    assert.equal(saved[0].releaseDay,5);
    saved[0].broadcast={day:4,source:'MyAnimeList via Jikan'};
    response=await message({type:'TRACKER_SCHEDULE_SYNC',entries:{'https://witanime.site/anime/example':1}}, {tab:{url:'https://witanime.site/schedule'}});
    assert.equal(response.ok,true);
    await sandbox.api.resolveBroadcast(saved[0]);
    assert.equal(saved[0].siteReleaseDay,1,'WitAnime URL mapping should replace the previous calendar source');
    assert.equal(saved[0].broadcast,undefined);
    assert.equal(saved[0].watched,0,'schedule migration preserves progress');
    response=await message({type:'TRACKER_SCHEDULE_SYNC',entries:{'https://witanime.site/anime/example':2}}, {tab:{url:'https://witanime.site/schedule'}});
    assert.equal(saved[0].siteReleaseDay,2,'schedule changes migrate existing follows automatically');
    response=await message({type:'TRACKER_SCHEDULE_SYNC',entries:{'https://witanime.site/anime/example':3}});
    assert.equal(response.ok,false,'untrusted senders cannot replace schedule data');
    assert.equal(saved[0].siteReleaseDay,2);
    assert.equal(notifications.length,1,'schedule sync must not notify old episodes again');
    saved[0].knownEpisodes=[1,2,3,4];
    await message({type:'TRACKER_UPDATE',id:'test',action:'watched',watched:2});
    assert.deepEqual([...saved[0].watchedEpisodes],[1,2]);
    await message({type:'TRACKER_UPDATE',id:'test',action:'episode_toggle',episode:2});
    assert.deepEqual([...saved[0].watchedEpisodes],[1],'an episode can be marked unwatched independently');
    await message({type:'TRACKER_UPDATE',id:'test',action:'episode_toggle',episode:4});
    assert.deepEqual([...saved[0].watchedEpisodes],[1,4],'non-contiguous progress must persist');
    await message({type:'TRACKER_GET'});
    assert.deepEqual([...saved[0].watchedEpisodes],[1,4],'reloading must not convert counts back to contiguous watched episodes');
    response=await message({type:'TRACKER_UPDATE',id:'test',action:'episode_toggle',episode:5});
    assert.equal(response.ok,false,'unavailable episodes cannot be toggled');
    await message({type:'TRACKER_UPDATE',id:'test',action:'episodes_all'});
    assert.equal(saved[0].watched,4);
    await message({type:'TRACKER_UPDATE',id:'test',action:'episodes_clear'});
    assert.equal(saved[0].watched,0);
    await message({type:'TRACKER_UPDATE',id:'test',action:'episodes_set',episodes:[1,4]});
    assert.deepEqual([...saved[0].watchedEpisodes],[1,4],'undo restores the exact mixed selection');
    await message({type:'TRACKER_UPDATE',id:'test',action:'notes',notes:'Stopped halfway through episode 2'});
    await message({type:'TRACKER_UPDATE',id:'test',action:'favorite'});
    assert.equal(saved[0].favorite,true);
    assert.match(saved[0].notes,/episode 2/);
}

function testCalendarSchedule() {
    const sandbox={Intl,Date};
    vm.runInNewContext(fs.readFileSync(path.join(root,'tracker-schedule.js'),'utf8')+'\nglobalThis.day=releaseWeekday;',sandbox);
    assert.equal(sandbox.day({checkedAt:Date.now(),createdAt:Date.now()}),null,'follow/check dates must never imply a release weekday');
    assert.equal(sandbox.day({releaseDay:5}),5);
    assert.equal(sandbox.day({siteReleaseDay:1,broadcast:{day:4,time:'00:30',timezone:'Asia/Tokyo'}},new Date('2026-10-08T12:00:00Z'),'Africa/Casablanca'),1,'WitAnime weekday must not be converted or shifted');
    assert.equal(sandbox.day({siteReleaseDay:0,releaseDay:4}),0,'Sunday from WitAnime takes priority over old overrides');
    assert.equal(sandbox.day({broadcast:{day:4,time:'00:30',timezone:'Asia/Tokyo',source:'MyAnimeList via Jikan'}}),null,'old external schedules are no longer used');
    assert.equal(sandbox.day({releaseDay:3,broadcast:{day:1,time:'00:30',timezone:'Asia/Tokyo'}}),3,'manual overrides take precedence');
}
function testProgressMigration() {
    const sandbox={};
    vm.runInNewContext(fs.readFileSync(path.join(root,'tracker-progress.js'),'utf8')+'\nglobalThis.api={migrateEpisodeProgress,animeProgress};',sandbox);
    const item={knownEpisodes:[1,2,3,4],latest:4,watched:2};
    sandbox.api.migrateEpisodeProgress(item);
    assert.deepEqual([...item.watchedEpisodes],[1,2],'legacy partial progress must migrate safely');
    item.watchedEpisodes=[1,4];
    sandbox.api.migrateEpisodeProgress(item);
    assert.equal(sandbox.api.animeProgress(item).next,2,'next unwatched is the first gap rather than count + 1');
    item.knownEpisodes.push(5);
    sandbox.api.migrateEpisodeProgress(item);
    assert.deepEqual([...item.watchedEpisodes],[1,4],'new episodes start unwatched');
}

function testWitAnimeHtml() {
    const sandbox={URL,Date};
    vm.runInNewContext(fs.readFileSync(path.join(root,'witanime-schedule.js'),'utf8')+'\nglobalThis.api={parseWitAnimeSchedule,WITANIME_SCHEDULE_SNAPSHOT};',sandbox);
    const {parseWitAnimeSchedule:parse,WITANIME_SCHEDULE_SNAPSHOT:snapshot}=sandbox.api;
    const fixture=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => `<section aria-labelledby="schedule-day-${day}"><a href="/anime/${day.toLowerCase()}">Anime</a></section>`).join('');
    assert.equal(parse(fixture)['https://witanime.site/anime/sun'],0);
    assert.equal(Object.keys(parse(fixture+fixture.replaceAll('schedule-day-','schedule-col-'))).length,7,'list and grid duplicates must collapse');
    assert.throws(() => parse('<html>403 Forbidden</html>'),/schedule unavailable/);
    if (process.argv[2]) {
        const actual=parse(fs.readFileSync(process.argv[2],'utf8'));
        assert.deepEqual({...actual},{...snapshot.entries},'bundled sanitized mapping must exactly match the supplied HTML');
        console.log(`Verified ${Object.keys(actual).length} anime across all seven weekdays against the supplied WitAnime HTML.`);
    }
}

(async () => {
    testExtensionReferences();
    testHostSelection();
    await testModernExtraction();
    await testRateLimits();
    await testTracker();
    testCalendarSchedule();
    testProgressMigration();
    testWitAnimeHtml();
    console.log('All Auto Downloader regression tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
