function editPendingEpisodes(job, numbers) {
    if (job.status !== 'paused') throw new Error('Pause the queue and wait until it is paused before editing');
    if (!Array.isArray(numbers) || new Set(numbers).size !== numbers.length) throw new Error('Invalid queue order');
    const pending=job.episodes.slice(job.nextIndex), byNumber=new Map(pending.map(e => [e.number,e]));
    if(numbers.some(n => !byNumber.has(n))) throw new Error('Only pending episodes can be reordered or removed');
    return [...job.episodes.slice(0,job.nextIndex),...numbers.map(n => byNumber.get(n))];
}
