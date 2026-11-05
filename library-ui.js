const librarySelection = new Set();
const detailDownloadSelection = new Map();
let librarySettings = validateOrbitSettings();
let libraryBusy = false;
const libraryControls = document.createElement('section');
libraryControls.className='library-controls';
libraryControls.innerHTML=`<div class="two"><input id="librarySearch" type="search" placeholder="Search titles or tags" aria-label="Search library"><select id="libraryStatus" aria-label="Watch status"><option value="">All statuses</option>${ORBIT_STATUSES.map(s => `<option>${s}</option>`).join('')}</select></div><div class="two"><select id="librarySort" aria-label="Sort library"><option value="title">Title</option><option value="unwatched">Most unwatched</option><option value="release">Release day</option><option value="recent">Recently watched</option><option value="rating">Highest rating</option></select><select id="libraryScope" aria-label="Library scope"><option value="active">Active library</option><option value="all">All, including archived</option><option value="favorites">Favorites</option><option value="archived">Archived</option></select></div><div class="detail-toolbar"><button id="dashboardBtn" class="secondary">Full dashboard ↗</button><button id="libraryOptionsBtn" class="secondary">Library settings</button></div><details><summary>Bulk status update</summary><div id="bulkAnimeList"></div><div class="two"><select id="bulkStatus" aria-label="New status">${ORBIT_STATUSES.map(s => `<option>${s}</option>`).join('')}</select><button id="bulkApply">Apply to selected</button></div></details><div id="libraryOverview"></div>`;
$('trackerView').prepend(libraryControls);
// Keep the small popup focused on the calendar; expanded tools belong in the dashboard.
const moreLibraryTools=document.createElement('details');moreLibraryTools.innerHTML='<summary>Library tools, filters & settings</summary>';
for(const child of [...libraryControls.children].slice(1)) moreLibraryTools.append(child);
libraryControls.append(moreLibraryTools);
if(new URLSearchParams(location.search).has('dashboard')) moreLibraryTools.open=true;
const libraryDialog=document.createElement('dialog');
libraryDialog.id='libraryDialog';
libraryDialog.innerHTML=`<button id="closeLibrary" class="detail-close secondary" aria-label="Close library settings">×</button><h2>Library settings</h2><div class="detail-toolbar"><button id="backupExport">Export backup</button><button id="backupRecovery" class="secondary">Recover pre-import data</button></div><label for="backupFile">Restore a backup (JSON, max 10 MB)</label><input id="backupFile" type="file" accept=".json,application/json"><label><input id="backupReplace" type="checkbox"> Replace library instead of adding new anime</label><p class="hint">Merge preserves existing titles. Replacing asks for confirmation and saves a recovery snapshot. Backups contain your private notes and history.</p><button id="backupImport" class="secondary">Preview and restore</button><button id="undoRemove" class="secondary">Undo last unfollow</button><h3>Appearance and notifications</h3><div class="two"><select id="libraryTheme" aria-label="Theme"><option value="dark">Dark</option><option value="light">Light</option></select><select id="libraryDensity" aria-label="Density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div><label><input id="quietEnabled" type="checkbox"> Quiet hours (browser local time)</label><div class="two"><label>From hour<input id="quietStart" type="number" min="0" max="23"></label><label>Until hour<input id="quietEnd" type="number" min="0" max="23"></label></div><label><input id="spoilerSafe" type="checkbox"> Hide synopsis and episode notes by default</label><button id="saveLibrarySettings">Save settings</button><p class="hint">Daily-digest titles are grouped once their alerts are 24 hours old. Alerts wait during quiet hours and require the browser to be running.</p><h3>Data and diagnostics</h3><button id="exportCalendar" class="secondary">Export recurring release calendar</button><button id="exportDiagnostics" class="secondary">Export privacy-safe diagnostics</button><p class="hint">Calendar entries are all-day weekly estimates, not confirmed release times. Diagnostics exclude titles, URLs, notes and viewing history.</p><p id="libraryMessage" role="status"></p>`;
document.body.append(libraryDialog);
const syncPanel=document.createElement('section');
syncPanel.innerHTML='<h3>Cross-device transfer (optional)</h3><p class="hint">Uses your browser’s sync account, if supported and signed in. Upload includes titles, progress, private notes and history. Transfers are manual; nothing uploads automatically. Keep a file backup too. Maximum encoded backup: 90 KB.</p><div class="detail-toolbar"><button id="syncUpload" class="secondary">Upload library to browser sync</button><button id="syncDownload" class="secondary">Preview synced library</button></div>';
$('libraryMessage').before(syncPanel);
const inboxDialog=document.createElement('dialog');
inboxDialog.id='inboxDialog';
inboxDialog.innerHTML='<button id="closeInbox" class="detail-close secondary" aria-label="Close notifications">×</button><h2>Release inbox</h2><button id="readInbox" class="secondary">Mark all read</button><div id="inboxEntries"></div><p id="inboxMessage" role="status"></p>';
document.body.append(inboxDialog);
if(new URLSearchParams(location.search).has('dashboard')) document.body.classList.add('dashboard');
function filterOrbitLibrary(items) {
    const query=$('librarySearch').value.trim().toLocaleLowerCase();
    const status=$('libraryStatus').value, scope=$('libraryScope').value;
    const filtered=items.filter(item => (!query || `${item.title} ${(item.tags || []).join(' ')}`.toLocaleLowerCase().includes(query))
        && (!status || (item.watchStatus || 'Watching')===status)
        && (scope==='all' || (scope==='archived' ? item.archived : !item.archived)) && (scope!=='favorites' || item.favorite));
    const sort=$('librarySort').value;
    return filtered.sort((a,b) => {
        if(sort==='rating') return (b.rating || 0)-(a.rating || 0) || a.title.localeCompare(b.title);
        if(sort==='recent') return (b.lastWatchedAt || 0)-(a.lastWatchedAt || 0);
        if(sort==='release') return (releaseWeekday(a) ?? 7)-(releaseWeekday(b) ?? 7);
        if(sort==='unwatched') {const ap=animeProgress(a),bp=animeProgress(b); return (bp.total-bp.count)-(ap.total-ap.count);}
        return a.title.localeCompare(b.title);
    });
}
function renderLibraryOverview() {
    const continuing=orbitList.filter(i => !i.archived && ['Watching','Rewatching'].includes(i.watchStatus || 'Watching') && animeProgress(i).next!==null);
    const weekStart=Date.now()-7*86400000;
    const weekCount=orbitList.reduce((n,i) => n+(i.watchHistory || []).filter(e => e.watched && e.at>=weekStart).length,0);
    const weekMinutes=orbitList.reduce((n,i) => n+(i.watchHistory || []).filter(e => e.watched && e.at>=weekStart).length*(i.episodeMinutes || 24),0);
    $('libraryOverview').innerHTML=`<p class="hint">${weekCount} watch events in the last 7 days · ${orbitList.filter(i => i.watchStatus==='Completed').length} completed titles</p><details><summary>Continue watching · ${continuing.length}</summary>${continuing.slice(0,12).map(i => `<button class="secondary" data-continue="${escapeHtml(i.id)}">${escapeHtml(i.title)} · episode ${animeProgress(i).next}</button>`).join('') || '<p class="hint">No episodes waiting.</p>'}</details><details><summary>Next seven days</summary>${Array.from({length:7},(_,offset) => {const day=new Date();day.setDate(day.getDate()+offset);const titles=orbitList.filter(i => !i.archived && !i.paused && releaseWeekday(i)===day.getDay());return `<p class="hint">${escapeHtml(day.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}))}: ${titles.map(i => escapeHtml(i.title)).join(', ') || 'No scheduled titles'}</p>`;}).join('')}</details>`;
    $('bulkAnimeList').innerHTML=orbitList.map(i => `<label><input type="checkbox" data-bulk="${escapeHtml(i.id)}" ${librarySelection.has(i.id) ? 'checked' : ''}> ${escapeHtml(i.title)}</label>`).join('');
    const estimate=document.createElement('p');estimate.className='hint';estimate.textContent=`Estimated viewing time this week: ${(weekMinutes/60).toFixed(1)} hours (based on watch events and configured episode lengths).`;$('libraryOverview').append(estimate);
    document.querySelectorAll('.anime-card').forEach(card => {
        const item=orbitList.find(i => i.id===card.dataset.id);
        const label=document.createElement('div');label.className='anime-meta';label.textContent=`${item.watchStatus || 'Watching'}${item.rating ? ` · ${item.rating}/10` : ''}${item.tags?.length ? ` · ${item.tags.join(', ')}` : ''}`;
        card.querySelector('.anime-body').append(label);
    });
}
function appendLibraryDetail(item) {
    migrateLibraryItem(item);
    const area=document.createElement('section');area.className='detail-library';
    area.innerHTML=`<h3>My library</h3><div class="two"><label>Status<select id="detailWatchStatus">${ORBIT_STATUSES.map(s => `<option ${item.watchStatus===s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>Rating / 10<input id="detailRating" type="number" min="0" max="10" value="${item.rating || 0}"></label></div><label>Tags / custom lists<input id="detailTags" value="${escapeHtml(item.tags.join(', '))}" placeholder="Weekend, Friends"></label><label>Release notifications<select id="detailNotify"><option value="instant">Immediately</option><option value="digest">Daily digest</option><option value="muted">Muted</option></select></label><button data-library="metadata">Save library preferences</button><div class="detail-toolbar"><button class="secondary" data-library="rewatch">Start rewatch</button><button class="secondary" data-library="archive">${item.archived ? 'Unarchive' : 'Archive'}</button></div><p class="hint">${item.rewatches.length} saved rewatch snapshot(s). Rewatching resets only current watched progress. Archive hides the title and stops checks.</p><h3>Selected episode ${selectedDetailEpisode ?? '—'}</h3><p class="hint">Downloaded and watched are independent. Confirm downloads manually when using IDM.</p><button class="secondary" data-library="downloaded" ${selectedDetailEpisode===null ? 'disabled' : ''}>${item.downloadedEpisodes.includes(selectedDetailEpisode) ? 'Mark not downloaded' : 'Confirm downloaded'}</button><label>Episode note<textarea id="detailEpisodeNote" maxlength="1000" ${selectedDetailEpisode===null ? 'disabled' : ''}>${escapeHtml(item.episodeNotes[selectedDetailEpisode] || '')}</textarea></label><button class="secondary" data-library="episode_note" ${selectedDetailEpisode===null ? 'disabled' : ''}>Save episode note</button><p class="hint">Confirmed downloaded: ${item.downloadedEpisodes.join(', ') || 'none'}</p><details><summary>Watch history</summary>${[...item.watchHistory].reverse().slice(0,50).map(e => `<p class="hint">Episode ${e.episode} · ${e.watched ? 'watched' : 'unwatched'} · ${escapeHtml(new Date(e.at).toLocaleString())}</p>`).join('') || '<p class="hint">New changes will appear here. Old viewing dates were not recorded.</p>'}</details><p class="hint">Last website check: ${item.checkedAt ? escapeHtml(new Date(item.checkedAt).toLocaleString()) : 'not checked'}<br>Schedule: ${Number.isInteger(item.siteReleaseDay) ? 'WitAnime weekday' : Number.isInteger(item.releaseDay) ? 'Manual fallback' : 'Unknown'} · ${item.scheduleCheckedAt ? escapeHtml(new Date(item.scheduleCheckedAt).toLocaleString()) : 'no capture'}${item.error ? `<br>${escapeHtml(item.error)}` : ''}</p>`;
    $('animeDetailContent').append(area);$('detailNotify').value=item.notificationMode;
    const latestWatch=[...item.watchHistory].reverse().find(e => e.episode===selectedDetailEpisode && e.watched);
    const localDate=latestWatch ? new Date(latestWatch.at-new Date(latestWatch.at).getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
    const extras=document.createElement('section');extras.innerHTML=`<label>Estimated minutes per episode<input id="detailEpisodeMinutes" type="number" min="1" max="300" value="${item.episodeMinutes}"></label><p class="hint">Saved with library preferences; used only for estimated statistics.</p><label>Selected episode rating / 10<input id="detailEpisodeRating" type="number" min="0" max="10" value="${item.episodeRatings[selectedDetailEpisode] || 0}" ${selectedDetailEpisode===null ? 'disabled' : ''}></label><button class="secondary" data-library="episode_rating" ${selectedDetailEpisode===null ? 'disabled' : ''}>Save episode rating</button><label>Selected episode viewing date<input id="detailWatchDate" type="datetime-local" value="${localDate}" ${selectedDetailEpisode===null ? 'disabled' : ''}></label><button class="secondary" data-library="watch_date" ${selectedDetailEpisode===null ? 'disabled' : ''}>Save viewing date</button>`;area.append(extras);
    const scheduleChange=item.scheduleChanges?.at(-1);
    if(scheduleChange) {const notice=document.createElement('p');notice.className='hint';notice.textContent=`Schedule changed: ${weekdayNames[scheduleChange.from]} → ${scheduleChange.to===null ? 'Unscheduled' : weekdayNames[scheduleChange.to]}, detected ${new Date(scheduleChange.at).toLocaleDateString()}`;area.append(notice);}
    if(item.lastReleaseObservedAt && Date.now()-item.lastReleaseObservedAt>8*86400000 && releaseWeekday(item)!==null && !['Completed','Dropped'].includes(item.watchStatus)) {const notice=document.createElement('p');notice.className='hint';notice.textContent='No new episode detected for over a week. Verify WitAnime for a possible break; this is not an official delay announcement.';area.append(notice);}
    const downloads=document.createElement('details');downloads.innerHTML=`<summary>Download episodes</summary><p class="hint">Select episodes, then review the queue. Current download preferences are used. Opening or downloading never changes watched progress.</p><div class="download-selection">${availableEpisodes(item).map(n => `<label><input type="checkbox" data-download-episode="${n}" ${(detailDownloadSelection.get(item.id) || []).includes(n) ? 'checked' : ''}>${n}</label>`).join('')}</div><div class="detail-toolbar"><button class="secondary" data-library="download_selected">Download selected</button><button class="secondary" data-library="download_unwatched">Download unwatched</button></div>`;area.append(downloads);
    const automatic=document.createElement('details');automatic.innerHTML=`<summary>Automatic downloads (optional)</summary><label><input id="detailAutoDownload" type="checkbox" ${item.autoDownload ? 'checked' : ''}> Download newly detected episodes for this anime</label><label>Maximum episodes per check<input id="detailAutoLimit" type="number" min="1" max="5" value="${item.autoDownloadLimit || 1}"></label><button class="secondary" data-library="auto_download">Save automation</button><p class="hint">Off by default. Uses your saved download preferences while the browser is running. No old backlog is downloaded. Busy queues are not interrupted. A backup restore leaves automation disabled.</p><p class="hint">${escapeHtml(item.autoDownloadMessage || '')}</p>`;area.append(automatic);
    if(librarySettings.spoilerSafe) {const synopsis=$('animeDetailContent').querySelector('.detail-synopsis');const spoiler=document.createElement('details');spoiler.innerHTML='<summary>Show synopsis</summary>';synopsis.replaceWith(spoiler);spoiler.append(synopsis);$('detailEpisodeNote').value='';$('detailEpisodeNote').placeholder='Saved note hidden; entering text will replace it';}
}
async function libraryRequest(action,extra={}) {
    const response=await chrome.runtime.sendMessage({type:'TRACKER_LIBRARY',action,...extra});
    if(!response?.ok) throw new Error(response?.error || 'Library unavailable');
    if(response.list) {orbitList=response.list;renderOrbit();}
    if(response.inbox) updateInboxBadge(response.inbox);
    return response;
}
function updateInboxBadge(inbox) {
    const count=inbox.filter(n => !n.read).length;
    $('notificationSettingsBtn').setAttribute('aria-label',`Release inbox: ${count} unread alerts`);
    const dot=$('notificationSettingsBtn').querySelector('.notification-dot');if(dot) dot.hidden=count===0;
}
function downloadOrbitFile(name,data,type='application/json') {
    const url=URL.createObjectURL(new Blob([data],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(() => URL.revokeObjectURL(url),10000);
}
function applyLibrarySettings(settings) {
    librarySettings=settings;document.documentElement.dataset.theme=settings.theme;document.body.classList.toggle('compact-mode',settings.density==='compact');
    $('libraryTheme').value=settings.theme;$('libraryDensity').value=settings.density;$('quietEnabled').checked=settings.quietEnabled;$('quietStart').value=settings.quietStart;$('quietEnd').value=settings.quietEnd;$('spoilerSafe').checked=settings.spoilerSafe;
}
async function showOrbitInbox() {
    try {const {inbox}=await libraryRequest('inbox');$('inboxEntries').innerHTML=[...inbox].reverse().map(n => `<article class="inbox-entry"><strong>${escapeHtml(n.title)}</strong><p>Episodes ${n.episodes.join(', ')} · ${n.read ? 'Read' : 'Unread'}</p><small>${escapeHtml(new Date(n.at).toLocaleString())}${n.pending ? ' · notification waiting' : ''}</small><button class="secondary" data-inbox="${escapeHtml(n.id)}">Mark read</button></article>`).join('') || '<p>No new release alerts yet.</p>';if(!inboxDialog.open) inboxDialog.showModal();}
    catch(e) {$('trackerHint').textContent=e.message;}
}
for(const id of ['librarySearch','libraryStatus','librarySort','libraryScope']) $(id).addEventListener(id==='librarySearch' ? 'input' : 'change',renderOrbit);
$('dashboardBtn').addEventListener('click',() => chrome.tabs.create({url:chrome.runtime.getURL('popup.html?dashboard=1')}));
$('libraryOptionsBtn').addEventListener('click',() => libraryDialog.showModal());
$('closeLibrary').addEventListener('click',() => libraryDialog.close());
$('closeInbox').addEventListener('click',() => inboxDialog.close());
$('notificationSettingsBtn').addEventListener('click',showOrbitInbox);
$('libraryOverview').addEventListener('click',event => {const button=event.target.closest('[data-continue]');if(button) openAnimeDetail(button.dataset.continue);});
$('bulkAnimeList').addEventListener('change',event => {const id=event.target.dataset.bulk;if(id) {if(event.target.checked) librarySelection.add(id);else librarySelection.delete(id);}});
$('bulkApply').addEventListener('click',async () => {try {await libraryRequest('bulk',{ids:[...librarySelection],status:$('bulkStatus').value});}catch(e){$('trackerHint').textContent=e.message;}});
$('readInbox').addEventListener('click',async () => {try{await libraryRequest('read');await showOrbitInbox();}catch(e){$('inboxMessage').textContent=e.message;}});
$('inboxEntries').addEventListener('click',async event => {const button=event.target.closest('[data-inbox]');if(button) {try{await libraryRequest('read',{id:button.dataset.inbox});await showOrbitInbox();}catch(e){$('inboxMessage').textContent=e.message;}}});
libraryDialog.addEventListener('click',async event => {
    const button=event.target.closest('button');if(!button || libraryBusy || button.id==='closeLibrary') return;
    libraryBusy=true;button.disabled=true;$('libraryMessage').textContent='';
    try {
        if(button.id==='backupExport') {const {backup}=await libraryRequest('export');downloadOrbitFile(`anime-orbit-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backup,null,2));}
        else if(button.id==='backupImport') {
            const file=$('backupFile').files[0];if(!file || file.size>10*1024*1024) throw new Error('Choose a JSON backup smaller than 10 MB');
            const backup=JSON.parse(await file.text());const preview=validateOrbitBackup(backup);const replace=$('backupReplace').checked;
            if(!confirm(`${replace ? 'Replace your library with' : 'Merge new titles from'} ${preview.list.length} anime? ${replace ? 'A recovery copy will be saved.' : 'Existing titles will not be changed.'}`)) return;
            await libraryRequest('import',{backup,replace});const stored=await chrome.storage.local.get('animeOrbitSettings');applyLibrarySettings(validateOrbitSettings(stored.animeOrbitSettings));$('libraryMessage').textContent='Backup restored.';
        } else if(button.id==='backupRecovery') {if(confirm('Restore the library saved before your last import?')) {await libraryRequest('recover');applyLibrarySettings(validateOrbitSettings((await chrome.storage.local.get('animeOrbitSettings')).animeOrbitSettings));$('libraryMessage').textContent='Recovery restored.';}}
        else if(button.id==='undoRemove') {await libraryRequest('undo_remove');$('libraryMessage').textContent='Anime restored.';}
        else if(button.id==='saveLibrarySettings') {const settings=validateOrbitSettings({theme:$('libraryTheme').value,density:$('libraryDensity').value,quietEnabled:$('quietEnabled').checked,quietStart:Number($('quietStart').value),quietEnd:Number($('quietEnd').value),spoilerSafe:$('spoilerSafe').checked});await libraryRequest('settings',{settings});applyLibrarySettings(settings);$('libraryMessage').textContent='Settings saved.';}
        else if(button.id==='exportDiagnostics') downloadOrbitFile('anime-orbit-diagnostics.json',JSON.stringify({version:chrome.runtime.getManifest().version,titles:orbitList.length,errors:orbitList.filter(i => i.error).length,unscheduled:orbitList.filter(i => releaseWeekday(i)===null).length,checked:orbitList.filter(i => i.checkedAt).length,at:Date.now()},null,2));
        else if(button.id==='exportCalendar') {
            const escapeICS=s => String(s).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
            const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Anime Orbit//Release Calendar//EN'];
            for(const item of orbitList.filter(i => !i.archived && releaseWeekday(i)!==null)) {
                const day=new Date();day.setDate(day.getDate()+(releaseWeekday(item)-day.getDay()+7)%7);const date=[day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('');
                lines.push('BEGIN:VEVENT',`UID:${escapeICS(item.id)}@anime-orbit`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${date}`,`RRULE:FREQ=WEEKLY;COUNT=13`,`SUMMARY:${escapeICS(item.title)}`,`DESCRIPTION:Estimated weekday from WitAnime or manual fallback; verify on the site.`,`URL:${escapeICS(item.url)}`,'END:VEVENT');
            }
            lines.push('END:VCALENDAR');downloadOrbitFile('anime-orbit-calendar.ics',lines.join('\r\n'),'text/calendar');
        }
        else if(button.id==='syncUpload') {
            if(!chrome.storage.sync) throw new Error('This browser does not expose sync storage');
            const {backup}=await libraryRequest('export');const encoded=encodeSyncBackup(backup);
            if(!confirm('Upload your library, including private notes and viewing history, to your browser sync account? This replaces the previously uploaded Orbit backup.')) return;
            const generation=crypto.randomUUID();const chunks=encoded.match(/.{1,6000}/g) || [];
            const payload={orbitSyncManifest:{generation,count:chunks.length,at:Date.now(),hash:await syncDigest(encoded)}};
            chunks.forEach((data,index) => {payload[`orbitSyncChunk${index}`]={generation,data};});
            await chrome.storage.sync.set(payload);$('libraryMessage').textContent='Uploaded to browser sync storage. Account synchronization is managed by your browser.';
        }
        else if(button.id==='syncDownload') {
            if(!chrome.storage.sync) throw new Error('This browser does not expose sync storage');
            const stored=await chrome.storage.sync.get(null),manifest=stored.orbitSyncManifest;
            if(!manifest || !Number.isInteger(manifest.count) || manifest.count<1 || manifest.count>15) throw new Error('No complete synced backup found');
            let encoded='';for(let index=0;index<manifest.count;index++) {const chunk=stored[`orbitSyncChunk${index}`];if(chunk?.generation!==manifest.generation || typeof chunk.data!=='string') throw new Error('Sync is incomplete. Wait for your browser to sync and try again.');encoded+=chunk.data;}
            if(encoded.length>90000 || await syncDigest(encoded)!==manifest.hash) throw new Error('Sync is incomplete or damaged; local data was not changed');
            const backup=decodeSyncBackup(encoded),preview=validateOrbitBackup(backup),replace=$('backupReplace').checked;
            if(!confirm(`${replace ? 'Replace your library with' : 'Merge new titles from'} the synced backup of ${preview.list.length} anime, uploaded ${new Date(manifest.at).toLocaleString()}? Existing local titles win during merge.`)) return;
            await libraryRequest('import',{backup,replace});applyLibrarySettings(validateOrbitSettings((await chrome.storage.local.get('animeOrbitSettings')).animeOrbitSettings));$('libraryMessage').textContent='Synced library restored; a local recovery snapshot was saved.';
        }
    } catch(e) {$('libraryMessage').textContent=e.message;}
    finally{libraryBusy=false;button.disabled=false;}
});
$('animeDetailContent').addEventListener('click',async event => {
    const button=event.target.closest('[data-library]');if(!button || detailBusy) return;
    const item=orbitList.find(i => i.id===detailAnimeId);if(!item) return;
    detailBusy=true;button.disabled=true;
    try {
        const action=button.dataset.library;
        if(action==='download_selected' || action==='download_unwatched') {
            const info=animeProgress(item);
            const numbers=action==='download_selected' ? (detailDownloadSelection.get(item.id) || []) : info.available.filter(n => !info.watched.includes(n));
            if(!numbers.length) throw new Error('Select at least one episode');
            const history=await chrome.runtime.sendMessage({type:'GET_HISTORY'});
            const previous=new Set((history?.history || []).flatMap(job => (job.results || []).filter(r => ['completed','external_handoff'].includes(r.status)).map(r => r.episodeUrl)));
            const duplicates=numbers.filter(n => item.downloadedEpisodes.includes(n) || previous.has(`${item.url.replace('/anime/','/watch/')}/${n}`));
            if(!confirm(`Start ${numbers.length} downloads for ${item.title}: ${numbers.join(', ')}?${duplicates.length ? `\nWarning: ${duplicates.join(', ')} were already confirmed downloaded or handed off.` : ''}\nManager: ${$('downloadManager').value}. Quality: ${$('quality').value || 'FHD'}.`)) return;
            const response=await chrome.runtime.sendMessage({type:'START_JOB',episodes:numbers.map(number => ({number,url:`${item.url.replace('/anime/','/watch/')}/${number}`})),options:{quality:$('quality').value || 'FHD',host:$('host').value || 'auto',version:$('version').value || null,lang:$('language').value || null,downloadManager:$('downloadManager').value,fallbackMode:$('fallbackMode').value,hostPriority:$('hostOrder').value.split(',').map(s => normalizeHostLabel(s.trim())).filter(s => HOST_PRIORITY.includes(s))}});
            if(!response?.ok) throw new Error(response?.error || 'Could not start queue');
            renderJob(response.job);$('animeDetailError').textContent='Queue started. See Downloads.';return;
        }
        if(action==='rewatch' && !confirm('Save your current progress and start a new rewatch?')) return;
        const message={type:'TRACKER_UPDATE',id:item.id,action};
        if(action==='auto_download') {
            const enabled=$('detailAutoDownload').checked;
            if(enabled && !item.autoDownload && !confirm('Allow Anime Orbit to start downloads automatically when NEW episodes of this anime are detected, using your saved preferences?')) return;
            Object.assign(message,{enabled,limit:Number($('detailAutoLimit').value)});
        }
        if(action==='metadata') Object.assign(message,{status:$('detailWatchStatus').value,rating:Number($('detailRating').value),tags:$('detailTags').value,notificationMode:$('detailNotify').value,minutes:Number($('detailEpisodeMinutes').value)});
        if(action==='episode_rating') Object.assign(message,{episode:selectedDetailEpisode,rating:Number($('detailEpisodeRating').value)});
        if(action==='watch_date') Object.assign(message,{episode:selectedDetailEpisode,at:new Date($('detailWatchDate').value).getTime()});
        if(action==='episode_note' || action==='downloaded') Object.assign(message,{episode:selectedDetailEpisode,note:$('detailEpisodeNote').value});
        await orbitMessage(message);$('animeDetailError').textContent='Saved';
    }catch(e){$('animeDetailError').textContent=e.message;}
    finally{detailBusy=false;renderAnimeDetail();}
});
$('animeDetailContent').addEventListener('change',event => {
    if(!event.target.dataset.downloadEpisode) return;
    const selected=new Set(detailDownloadSelection.get(detailAnimeId) || []),number=Number(event.target.dataset.downloadEpisode);
    if(event.target.checked) selected.add(number);else selected.delete(number);detailDownloadSelection.set(detailAnimeId,[...selected].sort((a,b) => a-b));
});
const presetPanel=document.createElement('section');presetPanel.className='panel';
presetPanel.innerHTML='<h3>Download presets</h3><div class="two"><input id="presetName" maxlength="40" placeholder="Preset name" aria-label="Preset name"><select id="presetSelect" aria-label="Saved presets"><option value="">Choose preset</option></select></div><div class="detail-toolbar"><button id="savePreset" class="secondary">Save current options</button><button id="loadPreset" class="secondary">Load</button><button id="deletePreset" class="secondary">Delete</button></div><p id="presetMessage" role="status" class="hint"></p>';
$('setupPanel').append(presetPanel);
async function refreshPresets() {const presets=validateOrbitPresets((await chrome.storage.local.get('animeOrbitPresets')).animeOrbitPresets);$('presetSelect').innerHTML='<option value="">Choose preset</option>'+Object.keys(presets).map(name => `<option>${escapeHtml(name)}</option>`).join('');return presets;}
presetPanel.addEventListener('click',async event => {
    const id=event.target.closest('button')?.id;if(!id) return;
    try {
        const presets=await refreshPresets();
        // refreshPresets rebuilds the select, so preserve the user's choice below.
        const name=id==='savePreset' ? $('presetName').value.trim() : presetPanel.dataset.selected;
        if(!name) throw new Error('Choose or name a preset');
        if(['__proto__','constructor','prototype'].includes(name)) throw new Error('Choose another preset name');
        const fields=['quality','host','version','language','downloadManager','fallbackMode','hostOrder'];
        if(id==='savePreset') {if(Object.keys(presets).length>=25 && !Object.hasOwn(presets,name)) throw new Error('Limit: 25 presets');presets[name]=Object.fromEntries(fields.map(field => [field,$(field).value]));}
        if(id==='deletePreset') delete presets[name];
        if(id==='loadPreset') {if(!presets[name]) throw new Error('Preset not found');for(const field of fields) {const el=$(field),value=presets[name][field];if(el.tagName!=='SELECT' || [...el.options].some(o => o.value===value)) el.value=value;}savedPrefs={...presets[name]};await chrome.storage.local.set({[PREFS_KEY]:savedPrefs});}
        await chrome.storage.local.set({animeOrbitPresets:presets});await refreshPresets();$('presetMessage').textContent=id==='loadPreset' ? 'Preset loaded. Website-specific options that are unavailable were skipped.' : 'Presets saved.';
    }catch(e){$('presetMessage').textContent=e.message;}
});
$('presetSelect').addEventListener('change',() => {presetPanel.dataset.selected=$('presetSelect').value;});
refreshPresets().catch(e => {$('presetMessage').textContent=e.message;});
function encodeSyncBackup(backup) {
    const bytes=new TextEncoder().encode(JSON.stringify(backup));
    if(bytes.length>67500) throw new Error('Library exceeds the browser sync budget. Use file export instead.');
    return btoa(String.fromCharCode(...bytes));
}
function decodeSyncBackup(encoded) {return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded),char => char.charCodeAt(0))));}
async function syncDigest(encoded) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encoded)))].map(byte => byte.toString(16).padStart(2,'0')).join('');}
document.addEventListener('keydown',event => {if((event.ctrlKey || event.metaKey) && event.key==='k') {event.preventDefault();$('librarySearch').focus();}});
chrome.storage.local.get(['animeOrbitSettings','animeOrbitInbox']).then(stored => {applyLibrarySettings(validateOrbitSettings(stored.animeOrbitSettings));updateInboxBadge(stored.animeOrbitInbox || []);renderOrbit();if(new URLSearchParams(location.search).has('inbox')) showOrbitInbox();}).catch(e => {$('trackerHint').textContent=e.message;});
chrome.runtime.onMessage.addListener(message => {
    if(message.type==='JOB_UPDATED' && message.job?.results?.some(record => record.status==='completed')) orbitMessage({type:'TRACKER_GET'}).catch(() => {});
});
