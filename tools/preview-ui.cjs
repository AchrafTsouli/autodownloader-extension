// Local visual QA only; fixture titles never enter extension storage.
const {chromium} = require('C:/Users/tsoul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const outputDir = path.resolve(process.env.ORBIT_PREVIEW_OUTPUT || path.resolve(__dirname,'../output/design'));
(async () => {
    const browser = await chromium.launch({executablePath:'C:/Users/tsoul/AppData/Local/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
    const page = await browser.newPage({viewport:{width:440,height:600},deviceScaleFactor:2});
    const errors=[];
    page.on('pageerror',error => errors.push(error.message));
    await page.addInitScript(() => {
        const season=['Winter','Spring','Summer','Fall'][Math.floor(new Date().getMonth()/3)];
        const titles=['Moonlit Academy','Beyond the Horizon','Crimson Letters','Tides of Tomorrow'];
        const list=titles.map((title,i) => ({id:String(i),title,season,year:new Date().getFullYear(),latest:i+4,watched:i+2,releaseDay:i===3 ? null : i+1,knownEpisodes:[1,2,3,4],checkedAt:Date.now()-720000,paused:false,url:'https://witanime.site/anime/example',latestUrl:'https://witanime.site/watch/example/4',poster:''}));
        const job={id:'preview',status:'running',createdAt:new Date().toISOString(),episodes:[1,2,3].map(number => ({number})),options:{downloadManager:'external'},results:[{episode:1,status:'external_handoff',actualHost:'mediafire',actualQuality:'FHD'},{episode:2,status:'preparing_download',actualHost:'workupload',actualQuality:'HD'}],currentEpisode:2};
        const storage={};
        window.chrome={storage:{local:{get:async () => storage,set:async data => Object.assign(storage,data)}},runtime:{getURL:path => `chrome-extension://preview/${path}`,getManifest:() => ({version:'4.4.1'}),onMessage:{addListener(){}},sendMessage:async message => {
            if(message.type==='CLEAR_JOB') return {ok:false,error:'Stop the active job before clearing it'};
            if(message.type==='TRACKER_UPDATE') {
                const item=list.find(entry => entry.id===message.id);
                if(message.action==='watched') item.watched=message.watched;
                if(message.action==='watched') item.watchedEpisodes=item.knownEpisodes.filter(number => number<=message.watched);
                if(message.action==='episode_toggle') {
                    const watched=new Set(item.watchedEpisodes || item.knownEpisodes.filter(number=>number<=item.watched));
                    if(watched.has(message.episode)) watched.delete(message.episode); else watched.add(message.episode);
                    item.watchedEpisodes=[...watched];item.watched=watched.size;
                }
                if(message.action==='episodes_all') item.watchedEpisodes=[...item.knownEpisodes];
                if(message.action==='episodes_clear') item.watchedEpisodes=[];
                if(message.action==='episodes_set') item.watchedEpisodes=[...message.episodes];
                if(message.action==='notes') item.notes=message.notes;
                if(message.action==='favorite') item.favorite=!item.favorite;
                if(message.action==='schedule') item.releaseDay=message.day;
                if(message.action==='metadata') Object.assign(item,{watchStatus:message.status,rating:message.rating,tags:message.tags.split(',').map(s => s.trim()),notificationMode:message.notificationMode});
                if(message.action==='downloaded') item.downloadedEpisodes=[message.episode];
                if(message.action==='episode_note') item.episodeNotes[message.episode]=message.note;
                if(message.action==='rewatch') {item.rewatches.push({at:Date.now(),watchedEpisodes:item.watchedEpisodes});item.watchedEpisodes=[];item.watchStatus='Rewatching';}
            }
            if(message.type==='TRACKER_LIBRARY' && message.action==='settings') storage.animeOrbitSettings=message.settings;
            return message.type.startsWith('TRACKER_') ? {ok:true,list,inbox:[]} : message.type==='GET_JOB' ? {ok:true,job} : {ok:true,history:[]};
        }},tabs:{query:async () => []}};
    });
    await page.goto('file:///'+path.resolve(__dirname,'../popup.html').replaceAll('\\','/'));
    await page.waitForSelector('.anime-card');
    await page.click('[data-calendar="1"]');
    if(await page.locator('.anime-card').count() !== 1) throw new Error('Release-day filtering failed');
    await page.click('[data-calendar="unknown"]');
    if(await page.locator('.anime-card').count() !== 1) throw new Error('Unknown schedule filtering failed');
    await page.click('[data-calendar="all"]');
    await page.locator('.progress-edit').first().click();
    await page.fill('#watchedEpisode','2');
    await page.click('#animeEditorForm button[type="submit"]');
    if(!await page.locator('.progress-edit').first().textContent().then(text=>text.includes('2 of 4'))) throw new Error('Partial progress did not render');
    await page.locator('.anime-menu summary').first().click();
    await page.locator('[data-action="schedule"]').first().click();
    await page.selectOption('#releaseDaySelect','5');
    await page.click('#animeEditorForm button[type="submit"]');
    await page.click('[data-calendar="5"]');
    if(await page.locator('.anime-card').count() !== 1) throw new Error('Saved weekday not used by calendar');
    await page.click('[data-calendar="all"]');
    await page.locator('.anime-body strong').first().click();
    await page.waitForSelector('#animeDetail[open]');
    if(await page.locator('.episode-square').count()!==4) throw new Error('Detail episode squares missing');
    await page.click('[data-episode="2"]');
    if(await page.locator('[data-episode="2"]').getAttribute('aria-pressed')!=='false') throw new Error('Cannot mark episode unwatched');
    await page.click('[data-episode="4"]');
    if(await page.locator('[data-episode="4"]').getAttribute('aria-pressed')!=='true') throw new Error('Cannot mark episode watched');
    await page.selectOption('#detailEpisodeFilter','unwatched');
    if(await page.locator('.episode-square').count()!==2) throw new Error('Unwatched episode filter failed');
    await page.selectOption('#detailEpisodeFilter','all');
    await page.click('[data-detail="clear"]');
    await page.click('[data-detail="undo"]');
    if(await page.locator('.episode-square.is-watched').count()!==2) throw new Error('Watch progress undo failed');
    await page.fill('#animeDetailNotes','My test note');
    await page.click('[data-detail="notes"]');
    await page.click('[data-detail="favorite"]');
    await page.selectOption('#detailWatchStatus','On hold');
    await page.fill('#detailRating','8');
    await page.fill('#detailTags','Weekend, Friends');
    await page.selectOption('#detailNotify','muted');
    await page.click('[data-library="metadata"]');
    if(await page.inputValue('#detailWatchStatus')!=='On hold' || await page.inputValue('#detailRating')!=='8') throw new Error('Library metadata did not save');
    await page.click('[data-library="downloaded"]');
    if(await page.locator('.episode-square.is-watched').count()!==2) throw new Error('Download state changed watched progress');
    fs.mkdirSync(outputDir,{recursive:true});
    await page.locator('#animeDetail').evaluate(dialog => {dialog.scrollTop=0;});
    await page.screenshot({path:path.join(outputDir,'anime-details.png')});
    await page.click('#closeAnimeDetail');
    await page.fill('#librarySearch','Crimson');
    if(await page.locator('.anime-card').count()!==1) throw new Error('Library search failed');
    await page.fill('#librarySearch','');
    await page.selectOption('#libraryStatus','On hold');
    if(await page.locator('.anime-card').count()!==1) throw new Error('Status filtering failed');
    await page.selectOption('#libraryStatus','');
    await page.locator('.library-controls > details > summary').click();
    await page.click('#libraryOptionsBtn');
    await page.selectOption('#libraryTheme','light');
    await page.selectOption('#libraryDensity','compact');
    await page.check('#quietEnabled');
    await page.click('#saveLibrarySettings');
    if(await page.locator('html').getAttribute('data-theme')!=='light') throw new Error('Theme did not apply');
    await page.selectOption('#libraryTheme','dark');
    await page.selectOption('#libraryDensity','comfortable');
    await page.click('#saveLibrarySettings');
    await page.click('#closeLibrary');
    await page.click('#notificationSettingsBtn');
    await page.waitForSelector('#inboxDialog[open]');
    await page.click('#closeInbox');
    fs.mkdirSync(outputDir,{recursive:true});
    for (const view of ['week','seasons','downloads']) {
        await page.click(`[data-view="${view}"]`);
        await page.evaluate(() => window.scrollTo(0,0));
        await page.screenshot({path:path.join(outputDir,`${view}.png`)});
        const overflow=await page.evaluate(() => document.documentElement.scrollWidth>440);
        if(overflow) throw new Error(`${view} has horizontal overflow`);
    }
    await page.click('#newBtn');
    if(!await page.locator('#progressPanel').isVisible() || await page.locator('#setupPanel').isVisible()) throw new Error('Rejected queue clearing hid the active job');
    if(!await page.locator('#status').textContent().then(text=>text.includes('Stop the active job'))) throw new Error('Rejected queue clearing did not show its error');
    await page.evaluate(() => renderJob({...currentJob,status:'failed',results:[
        {episode:1,status:'downloading',downloadId:1},{episode:2,status:'failed'}
    ]}));
    if(!await page.locator('#retryBtn').isDisabled() || await page.locator('#stopBtn').isDisabled()) throw new Error('A failed queue must protect downloads still in progress');
    await page.click('[data-view="seasons"]');
    await page.click('[data-season="Winter"]');
    if(await page.locator('.anime-card').count()) throw new Error('Season filter did not update');
    if(errors.length) throw new Error(errors.join('\n'));
    await page.goto('file:///'+path.resolve(__dirname,'../popup.html').replaceAll('\\','/')+'?dashboard=1');
    await page.setViewportSize({width:1200,height:800});
    await page.waitForSelector('.anime-card');
    if(!await page.locator('body').evaluate(body => body.classList.contains('dashboard'))) throw new Error('Dashboard mode missing');
    if(await page.evaluate(() => document.documentElement.scrollWidth>1200)) throw new Error('Dashboard has overflow');
    await page.screenshot({path:path.join(outputDir,'dashboard.png')});
    await page.click('[data-view="week"]');
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:path.join(outputDir,'empty.png')});
    console.log('Popup and dashboard rendered without overflow or script errors; episode progress, metadata, independent downloads, search, status filters, themes and inbox passed.');
    await browser.close();
})().catch(error => {console.error(error);process.exit(1);});
