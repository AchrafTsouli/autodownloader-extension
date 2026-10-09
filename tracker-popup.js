let orbitList = [];
let orbitView = 'week';
let calendarFilter = 'all';
let editorAnimeId = null;
let editorAction = null;
const weekdayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const currentDate = new Date();
const currentSeason = ['Winter', 'Spring', 'Summer', 'Fall'][Math.floor(currentDate.getMonth() / 3)];
$('trackSeason').value = currentSeason;
$('trackYear').value = currentDate.getFullYear();
async function orbitMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'Tracker unavailable');
    orbitList = response.list;
    renderOrbit();
    if (typeof renderAnimeDetail === 'function') renderAnimeDetail();
}
async function syncScheduleFromCurrentTab(tab) {
    if (!tab) [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!/^https:\/\/witanime\.site\//.test(tab?.url || '')) return;
    try {
        // Use the user's logged-in site session; anonymous schedule requests
        // can return WitAnime's own 403 page.
        const [{result}] = await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:async () => {
            if (location.pathname === '/schedule') return document.documentElement.outerHTML;
            const response = await fetch('/schedule',{credentials:'same-origin',signal:AbortSignal.timeout(15000)});
            return response.ok ? await response.text() : null;
        }});
        if (result) await orbitMessage({type:'TRACKER_SCHEDULE_SYNC',entries:parseWitAnimeSchedule(result)});
    } catch { /* Keep the last verified WitAnime schedule when unavailable. */ }
}
function renderOrbit() {
    const season = $('trackSeason').value;
    const year = Number($('trackYear').value);
    const selected = orbitList.filter(item => item.season === season && item.year === year);
    const activeItems = selected.filter(item => !item.paused);
    const items = orbitView === 'week' ? activeItems.filter(item => calendarFilter === 'all'
        || (calendarFilter === 'unknown' ? releaseWeekday(item) === null : releaseWeekday(item) === Number(calendarFilter))) : selected;
    const unread = items.filter(item => animeProgress(item).next !== null).length;
    $('seasonHeading').textContent = `${season} ${year}`;
    $('trackerSummary').textContent = `${unread} to catch up`;
    const seasonsView = orbitView === 'seasons';
    $('trackerSubtitle').textContent = seasonsView ? 'Your seasonal watchlist, all in one orbit.' : 'Your weekly episodes at a glance.';
    $('orbitStats').hidden = seasonsView;
    $('orbitStats').innerHTML = `<div><strong>${selected.length}</strong>following</div><div><strong>${unread}</strong>unwatched</div>`;
    $('weeklyStrip').hidden = seasonsView;
    $('calendarFilters').hidden = seasonsView;
    $('seasonStrip').hidden = !seasonsView;
    $('weeklySection').hidden = seasonsView;
    $('seasonArchive').hidden = !seasonsView;
    $('watchlistCards').classList.toggle('seasons-grid', seasonsView);
    const monday = new Date();
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    $('weeklyStrip').innerHTML = Array.from({length:7}, (_, index) => {
        const day = new Date(monday); day.setDate(day.getDate() + index);
        const count = activeItems.filter(item => releaseWeekday(item) === day.getDay()).length;
        return `<button data-calendar="${day.getDay()}" aria-pressed="${calendarFilter === String(day.getDay())}" class="week-day ${day.toDateString() === new Date().toDateString() ? 'today' : ''} ${calendarFilter === String(day.getDay()) ? 'selected-day' : ''}">${day.toLocaleDateString('en', {weekday:'short'})}<small>${day.toLocaleDateString('en', {month:'short',day:'numeric'})}</small><small>${count} release${count === 1 ? '' : 's'}</small></button>`;
    }).join('');
    $('seasonStrip').innerHTML = ['Winter','Spring','Summer','Fall'].map(name => `<button class="${name === season ? 'selected' : ''}" data-season="${name}">${name} ${year}</button>`).join('');
    const archived = [...new Set(orbitList.filter(item => item.season !== season || item.year !== year).map(item => `${item.season} ${item.year}`))];
    $('seasonArchive').innerHTML = archived.map(label => `<button class="archive-row" data-archive="${escapeHtml(label)}">▣ &nbsp; ${escapeHtml(label)} <small>View watchlist</small> &nbsp; ›</button>`).join('');
    const lastCheck = Math.max(0, ...items.map(item => item.checkedAt || 0));
    $('trackerFooter').innerHTML = `<span>●</span>${lastCheck ? `Checked ${Math.max(0,Math.floor((Date.now()-lastCheck)/60000))} min ago` : 'Hourly checks'} &nbsp; · &nbsp; ${items.length} tracking`;
    $('watchlistCards').innerHTML = items.length ? items.map(item => {
        const info=animeProgress(item);
        const fresh = info.next !== null;
        const poster = item.poster ? `<img class="anime-poster" src="${escapeHtml(item.poster)}" alt="" loading="lazy">` : '<div class="anime-poster">▷</div>';
        const checked = item.checkedAt ? `Checked ${new Date(item.checkedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : '';
        const controls = `<details class="anime-menu"><summary aria-label="Manage ${escapeHtml(item.title)}">⋮</summary><button data-action="watched">Edit watched progress</button><button data-action="schedule">Edit release day</button><button data-action="pause">${item.paused ? 'Resume tracking' : 'Pause tracking'}</button><button data-action="check">Check soon</button><button data-action="remove">Unfollow</button></details>`;
        const releaseDay = releaseWeekday(item);
        const schedule = releaseDay === null ? 'Not in WitAnime’s schedule' : `${weekdayNames[releaseDay]} · ${Number.isInteger(item.siteReleaseDay) ? 'WitAnime' : 'manual fallback'}`;
        const progress = info.total ? info.count/info.total*100 : 0;
        return `<article class="anime-card" data-id="${item.id}">${poster}${controls}<div class="anime-body"><strong>${escapeHtml(item.title)}</strong><div class="anime-meta">${fresh && !seasonsView ? '<span class="new-badge">UNWATCHED</span>' : ''}${seasonsView ? `${item.watched} of ${item.latest} episodes watched` : `Episode ${item.latest} available`}${item.paused ? ' · Paused' : ''}</div><div class="anime-meta">${escapeHtml(schedule)}</div>${seasonsView ? `<div class="card-progress"><span style="width:${progress}%"></span></div><button class="track-toggle ${item.paused ? 'paused' : ''}" data-action="pause" aria-label="${item.paused ? 'Resume' : 'Pause'} tracking" aria-pressed="${!item.paused}"><span></span></button>` : `<div class="anime-meta"><button class="progress-edit" data-action="watched">Watched ${item.watched} of ${item.latest} ✎</button> · ${escapeHtml(checked)}</div><button class="anime-open" data-action="open">▶ &nbsp; Open episode</button>`}${item.error ? `<div class="anime-meta">${escapeHtml(item.error)}</div>` : ''}</div></article>`;
    }).join('') : (calendarFilter !== 'all' && !seasonsView ? '<div class="empty-orbit"><strong>No releases on this day</strong>Unknown schedules are under Unscheduled. Set a release day from an anime’s menu.</div>' : '<div class="empty-orbit"><strong>Your season starts here</strong>Follow an anime from its WitAnime page. New episodes will appear here.</div>');
    document.querySelectorAll('#calendarFilters [data-calendar]').forEach(button => button.classList.toggle('selected', button.dataset.calendar === calendarFilter));
    document.querySelectorAll('.anime-body strong').forEach(title => {title.tabIndex=0;title.setAttribute('role','button');title.setAttribute('aria-label',`View details: ${title.textContent}`);});
    document.querySelectorAll('.anime-card').forEach(card => {
        const item=orbitList.find(entry => entry.id===card.dataset.id);
        const info=animeProgress(item);
        const edit=card.querySelector('.progress-edit');
        if(edit) edit.textContent=`Watched ${info.count} of ${info.total} ✎`;
        if(seasonsView) card.querySelector('.anime-meta').textContent=`${info.count} of ${info.total} episodes watched${item.paused ? ' · Paused' : ''}`;
    });
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    orbitView = button.dataset.view;
    document.querySelectorAll('[data-view]').forEach(tab => tab.classList.toggle('selected', tab === button));
    $('trackerView').hidden = orbitView === 'downloads';
    $('downloadsView').hidden = orbitView !== 'downloads';
    renderOrbit();
}));
['trackSeason', 'trackYear'].forEach(id => $(id).addEventListener('change', renderOrbit));
$('watchlistCards').addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) {
        if (event.target.closest('.anime-menu')) return;
        const card=event.target.closest('[data-id]');
        if(card) openAnimeDetail(card.dataset.id);
        return;
    }
    const id = button.closest('[data-id]').dataset.id;
    try {
        if (button.dataset.action === 'open') {
            const item = orbitList.find(entry => entry.id === id);
            await chrome.tabs.create({ url: item.latestUrl || item.url });
        } else if (['watched','schedule'].includes(button.dataset.action)) openAnimeEditor(id, button.dataset.action);
        else await orbitMessage({type:'TRACKER_UPDATE', id, action:button.dataset.action});
    } catch (error) { $('trackerHint').textContent = error.message; }
});
$('watchlistCards').addEventListener('keydown',event => {
    if ((event.key==='Enter' || event.key===' ') && event.target.matches('.anime-body strong')) {
        event.preventDefault();openAnimeDetail(event.target.closest('[data-id]').dataset.id);
    }
});
$('followAnimeBtn').addEventListener('click', async () => {
    $('followAnimeBtn').disabled = true;
    try {
        const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
        await syncScheduleFromCurrentTab(tab);
        const [{result}] = await chrome.scripting.executeScript({target:{tabId:tab.id}, func:() => {
            const match = location.pathname.match(/^\/(?:anime|watch)\/([^/]+)/);
            if (location.hostname !== 'witanime.site' || !match) throw new Error('Open a WitAnime anime page');
            const episodes = [...document.querySelectorAll('a[href]')].map(link => {
                const url = new URL(link.href, location.href);
                const route = url.pathname.match(/^\/watch\/([^/]+)\/(\d+)\/?$/);
                return url.origin === location.origin && route?.[1] === match[1] ? {number:Number(route[2]), url:url.href} : null;
            }).filter(Boolean).sort((a,b) => a.number-b.number);
            return {url:`https://witanime.site/anime/${match[1]}`, title:document.querySelector('h1')?.textContent.trim() || document.title,
                poster:[...document.images].map(image => image.currentSrc || image.src).find(url => /^https:\/\/images\.witanime\.site\/posters\//.test(url)) || document.querySelector('meta[property="og:image"]')?.content || '',
                description:document.querySelector('meta[name="description"]')?.content || '',
                episodes:[...new Set(episodes.map(item => item.number))], latestUrl:episodes.at(-1)?.url};
        }});
        await orbitMessage({type:'TRACKER_FOLLOW', item:{...result, season:$('trackSeason').value, year:Number($('trackYear').value)}});
        $('trackerHint').textContent = 'Following! Existing episodes are the baseline. New releases trigger notifications.';
    } catch (error) { $('trackerHint').textContent = error.message; }
    finally { $('followAnimeBtn').disabled = false; }
});
orbitMessage({type:'TRACKER_GET'}).then(() => syncScheduleFromCurrentTab()).catch(error => { $('trackerHint').textContent = error.message; });
$('seasonStrip').addEventListener('click', event => {
    if (event.target.dataset.season) { $('trackSeason').value = event.target.dataset.season; renderOrbit(); }
});
$('seasonArchive').addEventListener('click', event => {
    const label = event.target.closest('[data-archive]')?.dataset.archive;
    if (label) { const [season,year] = label.split(' '); $('trackSeason').value=season; $('trackYear').value=year; renderOrbit(); }
});
for (const id of ['orbitSettingsBtn','notificationSettingsBtn']) $(id).addEventListener('click', () => {
    $('seasonSettings').hidden = !$('seasonSettings').hidden;
    $('trackerHint').textContent = 'Choose the season and year for your watchlist. Use each card’s menu to pause notifications.';
});
for (const id of ['weeklyStrip','calendarFilters']) $(id).addEventListener('click', event => {
    const button = event.target.closest('[data-calendar]');
    if (button) { calendarFilter = button.dataset.calendar; renderOrbit(); }
});
function showScheduleSource(item) {
    $('scheduleSource').textContent = Number.isInteger(item.siteReleaseDay)
        ? `WitAnime assigns this anime to ${weekdayNames[item.siteReleaseDay]}. Schedule captured ${new Date(item.scheduleCheckedAt).toLocaleDateString()}. This website day takes priority.`
        : item.scheduleError || 'Not listed in WitAnime’s schedule. Open its schedule page while signed in to synchronize it.';
}
function openAnimeEditor(id, action) {
    const item = orbitList.find(entry => entry.id === id);
    editorAnimeId = id; editorAction = action;
    $('animeEditorTitle').textContent = item.title;
    $('animeEditorHint').textContent = action === 'watched' ? `${item.latest} episodes available. Set the last episode you finished.` : 'Your calendar follows the weekday shown in WitAnime’s schedule.';
    $('watchedEditor').hidden = action !== 'watched';
    $('scheduleEditor').hidden = action !== 'schedule';
    $('watchedEpisode').disabled = action !== 'watched';
    $('watchedEpisode').required = action === 'watched';
    $('watchedEpisode').max = item.latest;
    $('watchedEpisode').value = item.watched;
    $('releaseDaySelect').value = Number.isInteger(item.releaseDay) ? String(item.releaseDay) : '';
    showScheduleSource(item);
    $('animeEditorError').textContent = '';
    $('animeEditor').showModal();
}
$('cancelAnimeEditor').addEventListener('click', () => $('animeEditor').close());
$('animeEditorForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
        const message = {type:'TRACKER_UPDATE',id:editorAnimeId,action:editorAction};
        if (editorAction === 'watched') message.watched = Number($('watchedEpisode').value);
        else message.day = $('releaseDaySelect').value === '' ? null : Number($('releaseDaySelect').value);
        await orbitMessage(message);
        $('animeEditor').close();
    } catch (error) { $('animeEditorError').textContent = error.message; }
});
$('lookupScheduleBtn').addEventListener('click', async () => {
    $('lookupScheduleBtn').disabled = true;
    try {
        await syncScheduleFromCurrentTab();
        await orbitMessage({type:'TRACKER_UPDATE',id:editorAnimeId,action:'schedule_lookup'});
        showScheduleSource(orbitList.find(item => item.id === editorAnimeId));
    } catch (error) { $('animeEditorError').textContent = error.message; }
    finally { $('lookupScheduleBtn').disabled = false; }
});
