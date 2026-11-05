const advancedDownloadPanel=document.createElement('section');advancedDownloadPanel.className='panel';
advancedDownloadPanel.innerHTML='<h3>Queue editor</h3><p class="hint">Pause the queue first. Only episodes not yet processed can be moved or removed.</p><div id="pendingQueue"></div><h3>Download history and failures</h3><button id="refreshDownloadArchive" class="secondary">Refresh download records</button><div id="downloadArchive"></div><p id="advancedDownloadMessage" class="hint" role="status"></p>';
$('downloadsView').append(advancedDownloadPanel);
let advancedHistory=[];
async function confirmDownloadDuplicates(episodes) {
    const response=await chrome.runtime.sendMessage({type:'GET_HISTORY'});
    const stored=await chrome.storage.local.get('animeOrbitWatchlist');
    const known=new Set((response?.history || []).flatMap(job => (job.results || []).filter(record => ['completed','external_handoff'].includes(record.status)).map(record => record.episodeUrl)));
    for(const item of stored.animeOrbitWatchlist || []) for(const number of item.downloadedEpisodes || []) known.add(`${item.url.replace('/anime/','/watch/')}/${number}`);
    const duplicates=episodes.filter(episode => known.has(episode.url));
    return !duplicates.length || confirm(`Episodes ${duplicates.map(e => e.number).join(', ')} were previously confirmed downloaded or handed off. Download them again? IDM completion is not verified.`);
}
function renderAdvancedDownloads(job) {
    $('pendingQueue').innerHTML=job ? job.episodes.slice(job.nextIndex).map((episode,index) => `<div class="queue-edit-row"><span>Episode ${episode.number}</span><button class="secondary" data-queue="up" data-number="${episode.number}" ${job.status!=='paused' || index===0 ? 'disabled' : ''} aria-label="Move episode ${episode.number} earlier">↑</button><button class="secondary" data-queue="down" data-number="${episode.number}" ${job.status!=='paused' || index===job.episodes.length-job.nextIndex-1 ? 'disabled' : ''} aria-label="Move episode ${episode.number} later">↓</button><button class="secondary" data-queue="remove" data-number="${episode.number}" ${job.status!=='paused' ? 'disabled' : ''}>Remove</button></div>`).join('') || '<p class="hint">No pending episodes.</p>' : '<p class="hint">No queue yet.</p>';
}
async function loadDownloadArchive() {
    const response=await chrome.runtime.sendMessage({type:'GET_HISTORY'});if(!response?.ok) throw new Error(response?.error || 'History unavailable');advancedHistory=response.history;
    $('downloadArchive').innerHTML=advancedHistory.map((job,index) => `<details><summary>${escapeHtml(new Date(job.createdAt).toLocaleString())} · ${job.results?.length || 0} records</summary>${(job.results || []).map(record => `<div class="archive-result"><strong>Episode ${record.episode} · ${escapeHtml(record.status==='external_handoff' ? 'Sent to IDM — completion unverified' : record.status)}</strong><p class="hint">${escapeHtml([record.actualHost,record.actualQuality,record.reason].filter(Boolean).join(' · '))}</p>${record.status==='failed' ? `<button class="secondary" data-retry-job="${index}" data-retry-number="${record.episode}">Retry episode ${record.episode}</button>` : ''}</div>`).join('')}</details>`).join('') || '<p class="hint">No archived jobs.</p>';
}
$('pendingQueue').addEventListener('click',async event => {
    const button=event.target.closest('[data-queue]');if(!button || !currentJob) return;
    button.disabled=true;
    try {
        const numbers=currentJob.episodes.slice(currentJob.nextIndex).map(e => e.number),index=numbers.indexOf(Number(button.dataset.number));
        if(index<0) throw new Error('Episode no longer pending');
        if(button.dataset.queue==='remove') numbers.splice(index,1);
        else {const target=index+(button.dataset.queue==='up' ? -1 : 1);if(target<0 || target>=numbers.length) return;[numbers[index],numbers[target]]=[numbers[target],numbers[index]];}
        const response=await chrome.runtime.sendMessage({type:'EDIT_QUEUE',numbers});if(!response?.ok) throw new Error(response?.error || 'Queue edit failed');renderJob(response.job);
    }catch(e){$('advancedDownloadMessage').textContent=e.message;}finally{button.disabled=false;}
});
$('downloadArchive').addEventListener('click',async event => {
    const button=event.target.closest('[data-retry-job]');if(!button) return;
    try {
        const old=advancedHistory[Number(button.dataset.retryJob)],episode=old?.episodes.find(e => e.number===Number(button.dataset.retryNumber));
        if(!episode) throw new Error('Original episode URL is unavailable');
        if(!confirm(`Retry episode ${episode.number} with the original download options?`)) return;
        const response=await chrome.runtime.sendMessage({type:'START_JOB',episodes:[episode],options:old.options});if(!response?.ok) throw new Error(response?.error || 'Retry failed');renderJob(response.job);
    }catch(e){$('advancedDownloadMessage').textContent=e.message;}
});
$('refreshDownloadArchive').addEventListener('click',() => loadDownloadArchive().catch(e => {$('advancedDownloadMessage').textContent=e.message;}));
renderAdvancedDownloads(currentJob);loadDownloadArchive().catch(e => {$('advancedDownloadMessage').textContent=e.message;});
