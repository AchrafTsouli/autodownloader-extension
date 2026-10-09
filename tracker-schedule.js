// Use the weekday displayed by WitAnime without timezone reinterpretation.
// Follow/check timestamps and external broadcast calendars are never used.
function releaseWeekday(item) {
    if (Number.isInteger(item.siteReleaseDay) && item.siteReleaseDay >= 0 && item.siteReleaseDay <= 6) return item.siteReleaseDay;
    if (Number.isInteger(item.releaseDay) && item.releaseDay >= 0 && item.releaseDay <= 6) return item.releaseDay;
    return null;
}
