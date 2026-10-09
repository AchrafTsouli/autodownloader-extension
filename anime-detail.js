let detailAnimeId = null;
let detailFilter = 'all';
let selectedDetailEpisode = null;
let detailBusy = false;
const detailUndo = new Map();
const detailNotes = new Map();
function openAnimeDetail(id) {
    detailAnimeId=id; detailFilter='all'; selectedDetailEpisode=null;
    $('animeDetailError').textContent='';
    renderAnimeDetail();
    $('animeDetail').showModal();
}
function renderAnimeDetail() {
    const item=orbitList.find(entry => entry.id===detailAnimeId);
    if (!item) { if ($('animeDetail').open) $('animeDetail').close(); return; }
    const info=animeProgress(item);
    const day=releaseWeekday(item);
    const shown=info.available.filter(number => detailFilter==='all' || (detailFilter==='watched' ? info.watched.includes(number) : !info.watched.includes(number)));
    const poster=item.poster ? `<img src="${escapeHtml(item.poster)}" alt="" class="detail-poster">` : '<div class="detail-poster detail-placeholder">▷</div>';
    $('animeDetailContent').innerHTML=`<div class="detail-hero">${poster}<div><h2 id="animeDetailTitle">${escapeHtml(item.title)}</h2><p class="anime-meta">${escapeHtml(item.season)} ${item.year} · ${day===null ? 'Unscheduled' : weekdayNames[day]}</p><p class="detail-count">${info.count} / ${info.total} watched</p><div class="track"><div class="bar" style="width:${info.total ? info.count/info.total*100 : 0}%"></div></div><button class="detail-favorite secondary" data-detail="favorite">${item.favorite ? '★ Favorite' : '☆ Add favorite'}</button></div></div><p class="detail-synopsis">${escapeHtml(item.description || 'No synopsis saved yet. Open the anime’s WitAnime page and refresh its details.')}</p><div class="detail-toolbar"><button data-detail="next" ${info.next===null ? 'disabled' : ''}>▶ Next unwatched${info.next===null ? '' : ` · ${info.next}`}</button><button data-detail="page" class="secondary">WitAnime page ↗</button></div><h3>Episodes</h3><p class="hint">Click a square to toggle watched/unwatched. Opening an episode never marks it watched automatically.</p><div class="episode-filter"><label for="detailEpisodeFilter">Show</label><select id="detailEpisodeFilter"><option value="all">All episodes</option><option value="unwatched">Unwatched</option><option value="watched">Watched</option></select><span>✓ watched &nbsp; □ unwatched</span></div><div class="episode-grid">${shown.map(number => `<button class="episode-square ${info.watched.includes(number) ? 'is-watched' : ''}" data-episode="${number}" aria-label="Episode ${number}, ${info.watched.includes(number) ? 'watched; mark unwatched' : 'unwatched; mark watched'}" aria-pressed="${info.watched.includes(number)}">${number}<small>${info.watched.includes(number) ? '✓' : '○'}</small></button>`).join('') || '<p class="hint">No episodes match this filter.</p>'}</div><div class="detail-toolbar"><button class="secondary" data-detail="selected" ${selectedDetailEpisode===null ? 'disabled' : ''}>Open selected${selectedDetailEpisode===null ? '' : ` · ${selectedDetailEpisode}`} ↗</button><button class="secondary" data-detail="undo" ${detailUndo.has(item.id) ? '' : 'disabled'}>Undo watch change</button></div><div class="detail-toolbar"><button class="secondary" data-detail="all">Mark all watched</button><button class="secondary" data-detail="clear">Mark all unwatched</button></div><label for="animeDetailNotes">Personal notes</label><textarea id="animeDetailNotes" rows="3" maxlength="2000" placeholder="Your thoughts, where you left off…">${escapeHtml(detailNotes.get(item.id) ?? item.notes ?? '')}</textarea><div class="detail-toolbar"><button class="secondary" data-detail="notes">Save notes</button><button class="secondary" data-detail="refresh">Refresh details</button></div>`;
    $('detailEpisodeFilter').value=detailFilter;
    if(detailBusy) $('animeDetailContent').querySelectorAll('button').forEach(button => {button.disabled=true;});
}
async function openDetailEpisode(item,number) {
    await chrome.tabs.create({url:`${item.url.replace('/anime/','/watch/')}/${number}`});
}
$('closeAnimeDetail').addEventListener('click',() => $('animeDetail').close());
$('animeDetailContent').addEventListener('change',event => {
    if(event.target.id==='detailEpisodeFilter') {detailFilter=event.target.value; renderAnimeDetail();}
});
$('animeDetailContent').addEventListener('input',event => {
    if(event.target.id==='animeDetailNotes') detailNotes.set(detailAnimeId,event.target.value);
});
$('animeDetailContent').addEventListener('click',async event => {
    const button=event.target.closest('button');
    if(!button || detailBusy) return;
    const item=orbitList.find(entry => entry.id===detailAnimeId);
    if(!item) return;
    const info=animeProgress(item);
    const action=button.dataset.detail;
    $('animeDetailError').textContent='';
    detailBusy=true;
    const pendingId=item.id;
    try {
        const message={type:'TRACKER_UPDATE',id:item.id};
        if(button.dataset.episode) {
            selectedDetailEpisode=Number(button.dataset.episode);
            detailUndo.set(item.id,[...info.watched]);
            message.action='episode_toggle'; message.episode=selectedDetailEpisode;
            await orbitMessage(message);
        } else if(action==='next') await openDetailEpisode(item,info.next);
        else if(action==='selected') await openDetailEpisode(item,selectedDetailEpisode);
        else if(action==='page') await chrome.tabs.create({url:item.url});
        else if(action==='all' || action==='clear') {
            detailUndo.set(item.id,[...info.watched]);
            message.action=action==='all' ? 'episodes_all' : 'episodes_clear';
            await orbitMessage(message);
        } else if(action==='undo') {
            message.action='episodes_set'; message.episodes=detailUndo.get(item.id);
            await orbitMessage(message); detailUndo.delete(item.id);
        } else if(action==='notes' || action==='favorite') {
            message.action=action; message.notes=detailNotes.get(item.id) ?? item.notes ?? '';
            await orbitMessage(message);
            if(action==='notes') $('animeDetailError').textContent='Notes saved';
        } else if(action==='refresh') {
            const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
            if(!/^https:\/\/witanime\.site\//.test(tab?.url || '')) throw new Error('Open WitAnime in the active tab first, then refresh details.');
            const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',args:[item.url],func:async url => {
                const response=await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(15000)});
                if(!response.ok) throw new Error(`WitAnime HTTP ${response.status}`);
                const doc=new DOMParser().parseFromString(await response.text(),'text/html');
                return doc.querySelector('meta[name="description"]')?.content || '';
            }});
            if(!result) throw new Error('No description available on this page');
            await orbitMessage({...message,action:'description',description:result});
        }
    } catch(error) {$('animeDetailError').textContent=error.message;}
    finally {detailBusy=false; if(detailAnimeId===pendingId) renderAnimeDetail();}
});
