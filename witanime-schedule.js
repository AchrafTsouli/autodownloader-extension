// WitAnime publishes the same seven groups in list and grid views.
// Match canonical anime URLs, never titles or the day an anime was followed.
function parseWitAnimeSchedule(html) {
    const days = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
    const entries = {};
    const seen = new Set();
    for (const section of html.matchAll(/<section\b[^>]*aria-labelledby\s*=\s*["']schedule-(?:col|day)-(Sun|Mon|Tue|Wed|Thu|Fri|Sat)["'][^>]*>([\s\S]*?)<\/section>/gi)) {
        const name = section[1][0].toUpperCase()+section[1].slice(1).toLowerCase();
        seen.add(name);
        for (const link of section[2].matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
            try {
                const url = new URL(link[1].replace(/&amp;/g,'&'), 'https://witanime.site');
                if (url.origin !== 'https://witanime.site' || !/^\/anime\/[^/]+\/?$/.test(url.pathname)) continue;
                const canonical = url.origin+url.pathname.replace(/\/$/,'');
                if (entries[canonical] !== undefined && entries[canonical] !== days[name]) throw new Error('Conflicting WitAnime schedule days');
                entries[canonical] = days[name];
            } catch (error) {
                if (error.message === 'Conflicting WitAnime schedule days') throw error;
            }
        }
    }
    if (seen.size !== 7 || !Object.keys(entries).length) throw new Error('WitAnime schedule unavailable; open its schedule page while signed in');
    return entries;
}

// Sanitized weekday links from the user's Oct 8, 2026 saved schedule.
// No HTML, cookies, CSRF token, or account information is bundled.
const WITANIME_SCHEDULE_SNAPSHOT = {capturedAt:Date.parse('2026-10-08T00:00:00Z'),entries:{}};
const snapshotGroups = [
    ['one-piece','seihantai-na-kimi-to-boku-2nd-season','aoashi-season-2','tempal-item-no-chikara','tensei-kizoku-kantei-skill-de-nariagaru-3rd-season','ao-no-hako-season-2','mezametara-saikyou-soubi-to-uchuusenmochi-datta-node-ikkodate-mezashite-youhei-toshite-jiyuu-ni-ikitai','ojisan-wa-kawaii-mono-ga-osuki','yowaki-max-reijo-nano-ni-ratsuwan-konyakusha-sama-no-kake-ni-notte-shimatta','hotel-inhumans-season-2','kanata-kara','tank-chair'],
    ['seitokai-ni-mo-ana-wa-aru','doumo-suki-na-hito-ni-horegusuri-wo-irai-sareta-majo-desu','tensei-goblin-dakedo-shitsumon-aru','psyren'],
    ['sora-wa-akai-kawa-no-hotori','shiotaiou-no-satou-san-ga-ore-ni-dake-amai','choujun-choujou-senpai','chii-fuyo','battle-spirits-re-zekkai-no-ku','kyouran-reijou-nia-liston'],
    ['tensei-shitara-ken-deshita-ii','shin-tennis-no-ouji-sama-u-17-world-cup-kesshou-member-kettei-sen','tantei-wa-mou-shindeiru-season2','sasaki-to-pii-chan-season-2','sekai-saikyou-no-majo-hajimemashita','magic-knight-rayearth-2026','jyu-oh-mujin-dandivine','kikansha-no-mahou-wa-tokubetsu-desu-2nd-season'],
    ['tsuihou-sareta-tensei-juukishi-wa-game-chishiki-de-musou-suru','fx-senshi-kurumi-chan','koori-no-jouheki-2nd-season','hyouken-no-majutsushi-ga-sekai-wo-suberu-ii'],
    ['shiguang-dailiren-3rd-season','steel-ball-run-jojo-no-kimyou-na-bouken','nige-jouzu-no-wakagimi-2nd-season','uchi-no-otouto-domo-ga-sumimasen','tokyo-revengers-santen-sensou-hen','kusuriya-no-hitorigoto-3rd-season-cour-1','tougen-anki-nikko-kegon-no-taki-hen'],
    ['black-clover-2nd-season','bleach-sennen-kessen-hen-kashin-tan','meitantei-conan','honzuki-no-gekokujou-shisho-ni-naru-tame-ni-wa-shudan-wo-erandeiraremasen-ryushu-no-youjo','yasei-no-last-boss-ga-arawareta-2nd-season','keroro-gunsou','romelia-senki','tensei-shita-daiseijo-wa-seijo-de-aru-koto-wo-hitakakusu','vertex-force','zombie-sagashitemasu','marronnier-oukoku-no-shichinin-no-kishi','kashita-maryoku-wa-revo-barai-de-kyousei-choushuu','magicalexplorer','ranma12-3rd-season','genso-suikoden']
];
snapshotGroups.forEach((slugs,day) => slugs.forEach(slug => {WITANIME_SCHEDULE_SNAPSHOT.entries[`https://witanime.site/anime/${slug}`]=day;}));
