# Anime Orbit roadmap — v4.4

This release implements the first large batch of the proposed 55-feature roadmap.
It does **not** claim that the whole roadmap is finished. Existing functionality
is preserved and new automation is opt-in. No real downloads or cloud uploads
were performed during automated testing.

## Included now

- Planning, Watching, On hold, Dropped, Completed, and Rewatching statuses.
- Continue Watching, always opening the first missing episode rather than the latest.
- Dated episode watch/unwatch history, viewing-date editing, and saved rewatch snapshots.
- Anime and episode ratings; custom lists through comma-separated tags.
- Bulk status changes; per-episode notes and independent downloaded confirmation.
- Weekly watch-event statistics and estimated hours from configurable episode lengths.
- Rolling seven-day releases, schedule-source indicators and captured timestamps.
- Schedule-change history and a possible-break hint after a previously observed release goes quiet for over eight days. This is not an official delay announcement.
- Per-title immediate, daily-digest, or muted notifications; browser-local quiet hours.
- Persistent release inbox, read/unread controls, and episode-based unwatched counts.
- Estimated all-day weekly calendar export, limited to 13 recurring occurrences.
- Download selected or unwatched episodes with queue confirmation and duplicate warnings.
- Saved quality/host/manager/fallback presets; existing host fallback rules remain available.
- Reorder/remove unprocessed episodes while fully paused; retry individual archived failures.
- Download records with host, quality, outcome and reason; IDM handoffs remain explicitly unverified.
- Browser-confirmed downloads update the downloaded ledger without changing watched progress.
- Explicit per-anime automatic downloads of newly discovered episodes, capped at 1–5 per check. Existing backlogs are not downloaded. A busy queue is never replaced. Limit-skipped releases require manual selection, and errors are shown in the detail view.
- Search by title/tags; status, favorites and archive filters; sorting by title, unwatched count, release day, rating or last watch change.
- Archive/unarchive without losing tracking data; archived titles stop polling.
- Full-page dashboard, compact/comfortable density, dark/light themes and Ctrl/Cmd+K search focus.
- Spoiler-safe synopsis and episode-note display. This does not conceal every possible spoiler in titles or website content.
- Validated JSON export/import with library, watch history, notes, ratings, settings and download presets. Merge keeps existing titles; replace asks for confirmation. Imports save a recovery snapshot. Automatic downloads are disabled in restored records.
- Undo the last unfollow and recover the pre-import library.
- Optional **manual** browser-sync upload/download, with generation checks and SHA-256 integrity checks. Nothing uploads without explicit confirmation. Browser account support must be configured by the user. Encoded backups are capped at 90 KB; large libraries use file backups.
- Privacy-safe diagnostic export. Existing site-change detection remains in the downloader.
- Local cached library remains readable/editable without a network connection; refreshes/downloads still need the website.
- Legacy contiguous watched progress migrates to explicit episode sets without inventing historical viewing dates.

## Remaining work from the original proposal

| Roadmap area | What remains |
| --- | --- |
| Specials / OVAs and relationships | Separate episode identifiers, season/movie links and a trustworthy source of relationship metadata. Current episode parsing supports numbered WitAnime episodes. |
| Discovery | A real seasonal catalogue with genre/airing filters, sequel suggestions and related-title recommendations. The current Seasons tab is the user's library, not a public discovery catalogue. |
| Notifications | Fixed-time daily/weekly digests and OS notifications for schedule changes. Current daily digests become eligible 24 hours after each alert; schedule changes appear in details. |
| Downloads | Configurable file naming and trustworthy pre-download size estimates where hosts expose them. IDM completion requires a supported bridge; it cannot be inferred from Chrome cancellation. Duplicate detection covers manual confirmations and the retained recent job history, not a complete filesystem scan. |
| Design | Complete French/Arabic localization and RTL QA, configurable accent colours, broader keyboard shortcuts, and quick-action controls embedded on WitAnime. |
| Sync | Fully automatic cross-device synchronization and per-field conflict resolution. Current manual merges keep existing local titles rather than merging fields. |
| Data tools | General bulk editing beyond status changes and longer-term download archives beyond the existing 20-job retention limit. |

## How to try the new release

1. Reload the extension in your browser's extensions page.
2. Open Anime Orbit. Expand **Library tools, filters & settings** for additional controls.
3. Open **Full dashboard** for the larger layout.
4. Click an anime to manage its library preferences, episode history, notes, ratings and downloads.
5. Open **Library settings** to export a backup before trying replace/import or sync.
6. Use the header bell for the release inbox. Quiet hours are local to the browser, not the website's timezone.

## Verification

- `npm test`: extraction, source fallback, rate limits, schedule parsing, legacy migration,
  episode toggles, independent downloaded state, ratings, rewatching, viewing dates,
  invalid/valid imports, quiet-hour notifications, sync encoding/integrity primitives,
  opt-in automatic downloads, and queue-edit validation.
- Local headless Brave fixture tests: popup/dashboard layout, episode toggles and undo,
  metadata persistence, independent download state, search/status filtering, themes,
  inbox opening and calendar filtering. These are UI smoke tests, not live IDM,
  browser-account synchronization or real-download integration tests.
