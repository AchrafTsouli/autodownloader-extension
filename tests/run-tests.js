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

async function testEpisodeTabRecovery() {
    for (const scenario of ['missing', 'frame', 'repeated', 'stopped']) {
        let nextId = 100;
        let extracts = 0;
        const created = [], removed = [], attempts = [];
        const sandbox = {
            console, URL, setTimeout, clearTimeout, setInterval, clearInterval,
            importScripts() {},
            chrome: {
                runtime: {onMessage:eventStub(),onStartup:eventStub(),sendMessage:async () => {}},
                tabs: {onCreated:eventStub(),onUpdated:eventStub(),
                    create:async options => {created.push(options);return {id:nextId++};},
                    remove:async id => {removed.push(id);}},
                downloads:{onCreated:eventStub(),onChanged:eventStub()}, storage:{local:{}}, action:{},notifications:{}
            },
            save:async () => {}, wait:async () => {},
            extract:async () => ({downloads:['workupload','mediafire'].map(host => ({
                host,quality:'FHD',flow:'witanime_api',token:`session-${extracts + 1}-${host}`
            })), generation:++extracts}),
            attempt:async (job,record,tab,choice) => {
                attempts.push({tabId:tab.id,host:choice.item.host,token:choice.item.token});
                if (attempts.length === 1 || scenario === 'repeated') {
                    if (scenario === 'stopped') sandbox.stop();
                    throw new Error(scenario === 'frame' ? 'Frame with ID 0 was removed.' : `No tab with id: ${tab.id}`);
                }
                if (choice.item.host === 'workupload') throw new Error('Host temporarily unavailable');
                record.status='downloading';
                return {consumedEpisodeTab:false};
            }
        };
        vm.runInNewContext(['host-config.js','background.js'].map(file => fs.readFileSync(path.join(root,file),'utf8')).join('\n') + `
            saveJob=save; waitForTabComplete=wait; extractEpisode=extract; attemptDownloadChoice=attempt;
            globalThis.process=processEpisode;globalThis.stop=()=>{stopRequested=true;};`, sandbox);
        const job={results:[],options:{quality:'FHD',host:'auto',fallbackMode:'fallback',hostPriority:['workupload']}};
        await sandbox.process(job,{number:1,url:'https://witanime.site/watch/example/1'});
        if (scenario === 'missing' || scenario === 'frame') {
            assert.equal(job.results[0].status,'downloading',`${scenario}: fallback should recover`);
            assert.equal(created.length,2,'recovery must open a replacement episode tab');
            assert.equal(attempts[1].tabId,101,'retry must use the replacement tab');
            assert.equal(attempts[1].token,'session-2-workupload','retry must get a fresh token');
            assert.equal(attempts[2].token,'session-2-mediafire','later hosts must also use fresh tokens');
            assert.ok(removed.includes(100));
        } else if (scenario === 'repeated') {
            assert.equal(created.length,3,'persistent tab loss must stop after two recoveries');
            assert.equal(attempts.length,3,'persistent tab loss must not cascade across every host');
            assert.equal(job.results[0].status,'failed');
            assert.match(job.results[0].reason,/repeatedly closed or navigated/);
        } else {
            assert.equal(created.length,1,'stopping must not reopen the episode tab');
            assert.equal(job.results[0].status,'cancelled');
        }
    }
}

async function testModernGateNavigation() {
    const updates = [], navigations = [], prepared = [];
    const sandbox = {
        console, URL, setTimeout, clearTimeout, setInterval, clearInterval, importScripts() {},
        window:{location:{assign:url => navigations.push(url)}},
        chrome:{
            runtime:{onMessage:eventStub(),onStartup:eventStub(),sendMessage:async () => {}},
            tabs:{onCreated:eventStub(),onUpdated:{addListener:fn => updates.push(fn),removeListener() {}},
                update:async () => {throw new Error('Gate must navigate from the site document');}},
            scripting:{executeScript:async options => {
                assert.equal(options.target.tabId,202,'gate navigation must use the preparation tab');
                assert.equal(options.world,'MAIN');
                options.func(...options.args);
                return [];
            }},
            downloads:{onCreated:eventStub(),onChanged:eventStub()},storage:{local:{}},action:{},notifications:{}
        },
        wait:async () => {},
        extract:async () => ({downloads:[{host:'mediafire',quality:'FHD',token:'fresh-token'}]}),
        prepare:async (tabId,token) => {
            prepared.push({tabId,token});
            return 'https://witanime.site/watch/download-gate/fresh-token';
        }
    };
    vm.runInNewContext(['host-config.js','background.js'].map(file => fs.readFileSync(path.join(root,file),'utf8')).join('\n') + `
        waitForTabComplete=wait;extractEpisode=extract;prepareModernDownload=prepare;
        globalThis.api={openModernDownload,waitForDownloadStart};`,sandbox);
    await sandbox.api.openModernDownload(202,{host:'mediafire',quality:'FHD',token:'old-token'});
    assert.deepEqual(prepared,[{tabId:202,token:'fresh-token'}],'gate must be prepared with a fresh token from its own tab');
    assert.deepEqual(navigations,['https://witanime.site/watch/download-gate/fresh-token']);
    const started=sandbox.api.waitForDownloadStart(202,1000);
    const rejection=assert.rejects(started,/download gate rejected or expired/);
    updates.forEach(fn => fn(202,{status:'complete'},{url:navigations[0],title:'WitAnime — الصفحة غير موجودة'}));
    await rejection;
    sandbox.extract=async () => ({downloads:[]});
    // The replacement function below is scoped to the sandbox's injected API.
    vm.runInNewContext('extractEpisode=extract;',sandbox);
    await assert.rejects(sandbox.api.openModernDownload(202,{host:'mediafire',quality:'FHD'}),/no longer available/);
    assert.equal(navigations.length,1,'missing sources must not reuse an old gate');
}

async function testDownloadLifecycle() {
    const handlers={}, removed=[], confirmed=[];
    const sandbox={console,URL,setTimeout,clearTimeout,setInterval,clearInterval,
        crypto:require('node:crypto').webcrypto,importScripts() {},
        chrome:{
            runtime:{onMessage:{addListener:fn => {handlers.message=fn;}},onStartup:eventStub(),
                getPlatformInfo() {},sendMessage:async () => {}},
            alarms:{create() {},onAlarm:{addListener:fn => {handlers.alarm=fn;}}},
            tabs:{onCreated:{addListener:fn => {handlers.tab=fn;}},onUpdated:eventStub(),
                create:async () => ({id:20}),remove:async id => {removed.push(id);},
                update:async () => {},get:async () => ({url:'https://www.mediafire.com/file/test'})},
            downloads:{onCreated:{addListener:fn => {handlers.download=fn;}},onChanged:eventStub(),search:async () => [{state:'complete'}]},
            storage:{local:{}},action:{},notifications:{create:async () => {}}
        },
        save:async () => {},archive:async () => {},
        confirm:async record => {confirmed.push(record.episode);},serialize:action => action()
    };
    vm.runInNewContext(['host-config.js','queue-tools.js','background.js'].map(file => fs.readFileSync(path.join(root,file),'utf8')).join('\n') + `
        saveJob=save;archiveJob=archive;
        globalThis.confirmBrowserEpisodeDownload=confirm;globalThis.serializeTracker=serialize;
        globalThis.api={applyDownloadState,attemptDownloadChoice,startDownloadJob,waitForDownloadStart,runJob,
            setJob:job=>{activeJob=job;},instantDownload:()=>{waitForDownloadStart=async()=>({id:44,tabId:20,url:'https://download.mediafire.com/file'});}};`,sandbox);
    const message=(data,tabId=99) => new Promise(resolve => handlers.message(data,{tab:{id:tabId}},resolve));
    for (const mode of ['browser','external']) {
        const record={episode:1,status:'downloading',downloadId:44,downloadStartedAt:'now'};
        const job={options:{downloadManager:mode},results:[record]};sandbox.api.setJob(job);
        await sandbox.api.applyDownloadState(job,record,{state:'interrupted',error:'USER_CANCELED'});
        assert.equal(record.status,mode==='browser' ? 'cancelled' : 'external_handoff');
    }
    const record={episode:1,episodeUrl:'https://witanime.site/watch/example/1'};
    const job={status:'running',options:{downloadManager:'browser'},results:[record],episodes:[{number:1}],currentEpisode:1};
    sandbox.api.setJob(job);
    const waiting=sandbox.api.waitForDownloadStart(20,1000,{host:'mediafire',allowExternal:true});
    const response=await message({type:'HOST_STATUS',status:'waiting_for_verification',host:'mediafire'});
    assert.equal(response.ok,false,'unrelated host tabs must not change the active record');
    job.options.downloadManager='external';
    assert.equal((await message({type:'HOST_DOWNLOAD_TRIGGERED',host:'mediafire'})).ok,false,'unrelated tabs must not fake manager handoffs');
    // A genuine child tab remains associated with the pending download.
    handlers.tab({id:21,openerTabId:20});
    assert.equal((await message({type:'HOST_DOWNLOAD_TRIGGERED',host:'mediafire'},21)).ok,true);
    assert.equal((await waiting).external,true);

    let claimed=false;
    const correlated=sandbox.api.waitForDownloadStart(20,1000,{host:'mediafire'}).then(item => {claimed=true;return item;});
    await handlers.download({id:50,url:'https://example.org/unrelated.zip',referrer:'https://example.org/'});
    assert.equal(claimed,false,'an unrelated browser download must not advance the episode queue');
    await handlers.download({id:51,url:'https://cdn.example.org/episode.mp4',referrer:'https://www.mediafire.com/file/test'});
    assert.equal((await correlated).id,51,'Chrome downloads without tabId must match the host referrer');
    const blob=sandbox.api.waitForDownloadStart(20,1000,{host:'mega'});
    await handlers.download({id:52,url:'blob:https://mega.nz/example'});
    assert.equal((await blob).id,52,'blob downloads must match their host origin');

    sandbox.api.instantDownload();job.options.downloadManager='browser';
    await sandbox.api.attemptDownloadChoice(job,record,{id:10},{item:{host:'mediafire',quality:'FHD',url:'https://www.mediafire.com/file/test'}});
    assert.equal(record.status,'completed','a download completed before record registration must be reconciled');
    assert.deepEqual(confirmed,[1],'browser completion must update the downloaded ledger');

    job.status='failed';record.status='downloading';
    await assert.rejects(sandbox.api.startDownloadJob({}),/already running/,'an unfinished browser download must block queue replacement');
    assert.equal((await message({type:'RETRY_FAILED'})).ok,false,'retry must not replace an active download');
    assert.equal((await message({type:'CLEAR_JOB'})).ok,false,'clear must not lose an active download');
    record.status='failed';job.status='paused';
    assert.equal((await message({type:'RETRY_FAILED'})).ok,false,'retry must not replace a paused queue');

    record.status='downloading';job.status='running';job.queueFinished=true;job.nextIndex=1;
    await sandbox.api.runJob();
    assert.equal(record.status,'completed','worker recovery must catch downloads completed while asleep');
    assert.equal(job.status,'completed');
    assert.equal(typeof handlers.alarm,'function','recovery must also run after MV3 worker restarts');
}

function testExtensionReferences() {
    const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
    const popup = ['popup.js','tracker-popup.js','anime-detail.js','library-ui.js','download-library.js'].map(file => fs.readFileSync(path.join(root,file),'utf8')).join('\n');
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
    let postPreparationSlots = 0;
    sandbox.window.autoDownloaderSiteSlot = async () => {postPreparationSlots++;};
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
    assert.equal(postPreparationSlots,0,'prepared gates must open immediately without another pacing delay');
    assert.equal(gate, `https://witanime.site/watch/download-gate/${token}`);
    assert.equal(requests[1].url, `/watch/download-source/${token}`);
    sandbox.location.pathname = '/watch/movie/example-movie';
    await sandbox.window.autoDownloaderExtractEpisode();
    assert.equal(requests[2].url, '/watch/movie/example-movie/sources');

    const player={sourcesLoaded:false,sourcesError:false,downloads:{FHD:[{token:'b'.repeat(64),label:'Workupload'}]}};
    const query=sandbox.document.querySelector;
    sandbox.document.querySelector=selector => selector.startsWith('[x-data') ? {} : query(selector);
    sandbox.window.Alpine={$data:() => player};
    sandbox.setTimeout=callback => {player.sourcesLoaded=true;callback();};
    const before=requests.length;
    const native=await sandbox.window.autoDownloaderExtractEpisode();
    assert.equal(native.downloads[0].token,'b'.repeat(64),'extraction must wait for the native player tokens');
    assert.equal(native.downloads[0].host,'workupload');
    assert.equal(requests.length,before,'native player extraction must not issue a competing manifest request');
    player.sourcesError=true;player.sourcesStale=true;
    await assert.rejects(sandbox.window.autoDownloaderExtractEpisode(),/session expired/);
    assert.equal(requests.length,before,'a failed native manifest must not silently be requested again');
    player.sourcesError=false;player.sourcesLoaded=false;
    sandbox.setTimeout=callback => {callback();};
    await assert.rejects(sandbox.window.autoDownloaderExtractEpisode(),/timed out/);
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
    const extraStorage = {};
    const notifications = [];
    const automaticQueues=[];
    let trackerHandler;
    const sandbox = {
        URL, Date, AbortSignal,
        crypto: require('node:crypto').webcrypto,
        getJob: async () => null,
        startDownloadJob:async request => {automaticQueues.push(request);return {};},
        normalizeHostLabel:label => label,HOST_PRIORITY:[],
        chrome: {
            storage: { local: { get: async () => ({...extraStorage,animeOrbitWatchlist:saved,animeOrbitWitAnimeSchedule:cachedSchedule}), set: async data => {
                Object.assign(extraStorage,data);
                if (data.animeOrbitWatchlist) saved = data.animeOrbitWatchlist;
                if (data.animeOrbitWitAnimeSchedule) cachedSchedule = data.animeOrbitWitAnimeSchedule;
            } } },
            alarms: {create() {}, onAlarm:eventStub()},
            notifications: {onClicked:eventStub(), create:async (id, data) => {notifications.push(data);}},
            runtime: {id:'test-extension',getURL:path => `chrome-extension://test-extension/${path}`,onMessage:{addListener(handler) {trackerHandler=handler;}}}
        },
        fetch: async () => ({ok:true, text:async () => '<a href="/watch/example/1">1</a><a href="/watch/example/2">2</a><a href="/watch/other/99">99</a>'})
    };
    vm.runInNewContext(['tracker-progress.js','orbit-library.js','witanime-schedule.js','tracker-background.js'].map(file => fs.readFileSync(path.join(root,file),'utf8')).join('\n') + '\nglobalThis.api={episodeLinks,validateAnimeUrl,trackerTick,resolveBroadcast,queueReleaseNotice,flushReleaseNotices};', sandbox);
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
    saved[0].watchedEpisodes=[2];saved[0].nextCheck=0;
    sandbox.fetch=async () => ({ok:true,text:async () => '<a href="/watch/example/1">1</a>'});
    await sandbox.api.trackerTick();
    await message({type:'TRACKER_GET'});
    assert.deepEqual([...saved[0].knownEpisodes],[1,2],'a partial episode response must preserve the notification baseline');
    assert.deepEqual([...saved[0].watchedEpisodes],[2],'partial episode responses must not erase watched progress');
    assert.equal(saved[0].latest,2);
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
    assert.ok(saved[0].watchHistory.some(e => e.episode===4 && e.watched),'independent episode changes must be dated');
    await message({type:'TRACKER_UPDATE',id:'test',action:'downloaded',episode:3});
    assert.deepEqual([...saved[0].downloadedEpisodes],[3]);
    assert.deepEqual([...saved[0].watchedEpisodes],[1,4],'download confirmation never changes watched progress');
    await message({type:'TRACKER_UPDATE',id:'test',action:'metadata',status:'On hold',rating:8,tags:'Weekend, Friends',notificationMode:'muted'});
    assert.equal(saved[0].watchStatus,'On hold');
    assert.equal(saved[0].rating,8);
    assert.deepEqual([...saved[0].tags],['Weekend','Friends']);
    await message({type:'TRACKER_UPDATE',id:'test',action:'rewatch'});
    assert.deepEqual([...saved[0].rewatches[0].watchedEpisodes],[1,4]);
    assert.equal(saved[0].watched,0);
    const trusted={id:'test-extension',url:'chrome-extension://test-extension/popup.html?dashboard=1'};
    saved[0].season='Fall';saved[0].year=2026;
    response=await message({type:'TRACKER_LIBRARY',action:'export'},trusted);
    assert.equal(response.ok,true);
    const backup=response.backup;
    response=await message({type:'TRACKER_LIBRARY',action:'import',backup:{format:'broken'},replace:true},trusted);
    assert.equal(response.ok,false);
    assert.equal(saved.length,1,'bad imports cannot erase the library');
    response=await message({type:'TRACKER_LIBRARY',action:'import',backup,replace:true},trusted);
    assert.equal(response.ok,true);
    assert.equal(saved[0].rating,8);
    assert.deepEqual([...saved[0].downloadedEpisodes],[3]);
    assert.equal(extraStorage.animeOrbitRecovery.list.length,1);
    response=await message({type:'TRACKER_LIBRARY',action:'settings',settings:{quietEnabled:true,quietStart:22,quietEnd:8}},{});
    assert.equal(response.ok,false,'untrusted senders cannot modify library settings');
    await message({type:'TRACKER_LIBRARY',action:'settings',settings:{quietEnabled:true,quietStart:0,quietEnd:0}},trusted);
    const beforeQuiet=notifications.length;
    saved[0].notificationMode='instant';
    await sandbox.api.queueReleaseNotice(saved[0],[[5,'']]);
    assert.equal(notifications.length,beforeQuiet,'quiet hours defer OS notifications');
    assert.equal(extraStorage.animeOrbitInbox.at(-1).pending,true);
    await message({type:'TRACKER_LIBRARY',action:'settings',settings:{quietEnabled:false}},trusted);
    await sandbox.api.flushReleaseNotices();
    assert.equal(notifications.length,beforeQuiet+1,'quiet-hour alerts deliver after quiet hours');
    saved[0].notificationMode='muted';
    await sandbox.api.queueReleaseNotice(saved[0],[[6,'']]);
    assert.equal(extraStorage.animeOrbitInbox.at(-1).pending,false,'muted titles still appear in the inbox without OS alerts');
    await message({type:'TRACKER_LIBRARY',action:'read'},trusted);
    assert.ok(extraStorage.animeOrbitInbox.every(n => n.read && !n.pending));
    await message({type:'TRACKER_UPDATE',id:saved[0].id,action:'episode_rating',episode:2,rating:9});
    assert.equal(saved[0].episodeRatings[2],9);
    await message({type:'TRACKER_UPDATE',id:saved[0].id,action:'episode_toggle',episode:2});
    await message({type:'TRACKER_UPDATE',id:saved[0].id,action:'watch_date',episode:2,at:Date.now()-86400000});
    assert.ok(saved[0].watchHistory.some(e => e.episode===2 && e.watched && e.at<Date.now()-3600000));
    assert.equal(saved[0].autoDownload,undefined,'automation is off after import');
    await message({type:'TRACKER_UPDATE',id:saved[0].id,action:'auto_download',enabled:true,limit:1});
    saved[0].nextCheck=0;
    sandbox.fetch=async () => ({ok:true,text:async () => [1,2,3,4,5,6].map(n => `<a href="/watch/example/${n}">${n}</a>`).join('')});
    await sandbox.api.trackerTick();
    assert.equal(automaticQueues.length,1);
    assert.deepEqual([...automaticQueues[0].episodes].map(e => e.number),[5],'auto-download queues only new releases and obeys its limit');
    saved[0].nextCheck=0;await sandbox.api.trackerTick();
    assert.equal(automaticQueues.length,1,'already discovered episodes are never auto-queued again');
}

function testLibraryValidation() {
    const sandbox={URL,Date,crypto:require('node:crypto').webcrypto};
    vm.runInNewContext(['tracker-progress.js','orbit-library.js'].map(file => fs.readFileSync(path.join(root,file),'utf8')).join('\n')+'\nglobalThis.api={validateOrbitBackup,validateOrbitSettings,orbitQuietNow};',sandbox);
    const {validateOrbitBackup:validate,orbitQuietNow:quiet}=sandbox.api;
    const backup={format:'anime-orbit',schema:1,list:[{url:'https://witanime.site/anime/example',title:'Example',season:'Fall',year:2026,knownEpisodes:[1,2,3],watchedEpisodes:[1,3],notes:'Keep me',watchHistory:[{episode:1,watched:true,at:1234}]}]};
    const restored=validate(backup);
    assert.deepEqual([...restored.list[0].watchedEpisodes],[1,3]);
    assert.equal(restored.list[0].notes,'Keep me');
    assert.equal(restored.list[0].watchHistory[0].at,1234);
    assert.throws(() => validate({...backup,list:[{...backup.list[0],url:'https://evil.example/anime/test'}]}),/invalid anime URL/);
    assert.throws(() => validate({...backup,list:[backup.list[0],backup.list[0]]}),/duplicate/);
    assert.throws(() => validate({...backup,list:[{...backup.list[0],knownEpisodes:[-2]}]}),/Invalid episode/);
    const settings={quietEnabled:true,quietStart:22,quietEnd:8};
    assert.equal(quiet(settings,new Date(2026,9,9,23)),true);
    assert.equal(quiet(settings,new Date(2026,9,9,7)),true);
    assert.equal(quiet(settings,new Date(2026,9,9,8)),false);
    assert.equal(quiet(settings,new Date(2026,9,9,12)),false);
    assert.throws(() => sandbox.api.validateOrbitSettings({quietStart:25}),/Quiet hours/);
}
function testQueueEditing() {
    const sandbox={};vm.runInNewContext(fs.readFileSync(path.join(root,'queue-tools.js'),'utf8')+'\nglobalThis.edit=editPendingEpisodes;',sandbox);
    const job={status:'paused',nextIndex:1,episodes:[{number:1},{number:2},{number:3}]};
    assert.deepEqual([...sandbox.edit(job,[3,2])].map(e => e.number),[1,3,2]);
    assert.deepEqual([...sandbox.edit(job,[3])].map(e => e.number),[1,3]);
    assert.throws(() => sandbox.edit({...job,status:'running'},[2,3]),/Pause/);
    assert.throws(() => sandbox.edit(job,[1,3]),/pending/);
    assert.throws(() => sandbox.edit(job,[2,2]),/Invalid/);
}
async function testSyncEncoding() {
    const source=fs.readFileSync(path.join(root,'library-ui.js'),'utf8');
    const helpers=source.slice(source.indexOf('function encodeSyncBackup('),source.indexOf("document.addEventListener('keydown'"));
    const sandbox={TextEncoder,TextDecoder,btoa,atob,crypto:require('node:crypto').webcrypto};
    vm.runInNewContext(helpers+'\nglobalThis.api={encodeSyncBackup,decodeSyncBackup,syncDigest};',sandbox);
    const unicode={title:'أنمي Français 日本語',notes:'私のノート'},encoded=sandbox.api.encodeSyncBackup(unicode);
    assert.deepEqual({...sandbox.api.decodeSyncBackup(encoded)},unicode,'sync preserves non-Latin titles and notes');
    assert.equal((await sandbox.api.syncDigest(encoded)).length,64);
    assert.throws(() => sandbox.api.encodeSyncBackup({notes:'x'.repeat(70000)}),/sync budget/);
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
    await testEpisodeTabRecovery();
    await testModernGateNavigation();
    await testDownloadLifecycle();
    await testModernExtraction();
    await testRateLimits();
    await testTracker();
    testCalendarSchedule();
    testProgressMigration();
    testLibraryValidation();
    testQueueEditing();
    await testSyncEncoding();
    testWitAnimeHtml();
    console.log('All Auto Downloader regression tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
