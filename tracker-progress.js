function availableEpisodes(item) {
    return [...new Set((item.knownEpisodes || []).filter(number => Number.isInteger(number) && number > 0))].sort((a,b) => a-b);
}
function watchedEpisodeNumbers(item) {
    const available = availableEpisodes(item);
    return Array.isArray(item.watchedEpisodes)
        ? available.filter(number => item.watchedEpisodes.includes(number))
        : available.filter(number => number <= (item.watched || 0));
}
function migrateEpisodeProgress(item) {
    item.watchedEpisodes = watchedEpisodeNumbers(item);
    item.watched = item.watchedEpisodes.length;
}
function animeProgress(item) {
    const available = availableEpisodes(item);
    const watched = watchedEpisodeNumbers(item);
    return {available,watched,total:available.length,count:watched.length,next:available.find(number => !watched.includes(number)) ?? null};
}
