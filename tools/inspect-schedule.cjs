const { chromium } = require('C:/Users/tsoul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
    const browser = await chromium.launch({executablePath:'C:/Users/tsoul/AppData/Local/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
    const page = await browser.newPage();
    await page.goto('https://witanime.site/',{waitUntil:'domcontentloaded'});
    console.log('Homepage:',await page.title());
    await page.goto('https://witanime.site/schedule',{waitUntil:'domcontentloaded'});
    console.log('Schedule:',await page.title());
    console.log((await page.content()).split('\n').filter(line => /schedule|day|السبت|الأحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|anime\//i.test(line)).join('\n'));
    await browser.close();
})().catch(error => {console.error(error);process.exitCode=1;});
