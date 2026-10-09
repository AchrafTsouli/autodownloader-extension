// Local visual QA only; fixture titles never enter extension storage.
const {chromium} = require('C:/Users/tsoul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
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
        window.chrome={storage:{local:{get:async () => ({}),set:async () => {}}},runtime:{onMessage:{addListener(){}},sendMessage:async message => {
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
            }
            return message.type.startsWith('TRACKER_') ? {ok:true,list} : message.type==='GET_JOB' ? {ok:true,job} : {ok:true,history:[]};
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
    fs.mkdirSync(path.resolve(__dirname,'../output/design'),{recursive:true});
    await page.locator('#animeDetail').evaluate(dialog => {dialog.scrollTop=0;});
    await page.screenshot({path:path.resolve(__dirname,'../output/design/anime-details.png')});
    await page.click('#closeAnimeDetail');
    fs.mkdirSync(path.resolve(__dirname,'../output/design'),{recursive:true});
    for (const view of ['week','seasons','downloads']) {
        await page.click(`[data-view="${view}"]`);
        await page.evaluate(() => window.scrollTo(0,0));
        await page.screenshot({path:path.resolve(__dirname,`../output/design/${view}.png`)});
        const overflow=await page.evaluate(() => document.documentElement.scrollWidth>440);
        if(overflow) throw new Error(`${view} has horizontal overflow`);
    }
    await page.click('[data-view="seasons"]');
    await page.click('[data-season="Winter"]');
    if(await page.locator('.anime-card').count()) throw new Error('Season filter did not update');
    if(errors.length) throw new Error(errors.join('\n'));
    await page.click('[data-view="week"]');
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:path.resolve(__dirname,'../output/design/empty.png')});
    console.log('Three popup views rendered without overflow or script errors; season filtering passed.');
    await browser.close();
})().catch(error => {console.error(error);process.exit(1);});
