# Anime Orbit 4.4.1 reliability review

Reviewed on 2026-11-04. This is a source review and automated regression/fixture
check, not a certification that every external host works in every browser.

## Reliability changes

- Reuse the Witanime player's loaded source tokens, wait for initialization,
  and avoid racing its source-manifest request. Open a freshly prepared gate
  immediately from the Witanime tab that prepared it.
- Recover from missing episode tabs with bounded retries and fresh tokens.
  Report rejected download gates instead of waiting for a host timeout.
- Reconcile downloads that finish or are interrupted before their queue record
  receives its browser download ID.
- Reconcile persisted browser download IDs on startup and a one-minute recovery
  alarm; resume a persisted active queue after an MV3 worker restart.
- Preserve active browser downloads when another episode fails. Block Retry,
  New job, and archived retries from replacing those downloads or a paused queue.
  Keep Stop available, and display rejected New job requests without hiding
  the current job.
- Treat browser-mode cancellation as cancellation. External-mode cancellation
  remains an explicitly unverified handoff, never confirmed completion.
- Associate downloads without tab IDs using their URL/referrer and known host
  tabs. Ignore unrelated host status/handoff messages while retaining support
  for child redirect tabs and host-origin blob downloads.
- Preserve observed episode numbers and watched progress when a later website
  response contains only part of the episode list.

## Checks passed

- `npm test`: existing extraction, fallback, pacing, tracking, schedule parsing,
  progress migration, library/backup validation, notification, sync encoding,
  automatic-download, and queue-editing regressions, plus new tab-loss,
  native-player token, gate navigation, quick completion, cancellation,
  queue protection, download correlation, worker recovery, and partial-list cases.
- JavaScript syntax checks for all top-level extension scripts and the UI runner.
- `git diff --check`: no whitespace errors.
- Local headless Brave fixture tests: popup and dashboard, episode toggles and
  undo, notes, metadata, independent downloaded state, search/status/calendar
  filters, themes, inbox, rejected queue clearing, active-download controls,
  and horizontal overflow/script-error checks.
- UI screenshots are in `output/verification/`; existing design screenshots
  were not overwritten by this review.

## Live verification limits

The user confirmed the Witanime-to-Mediafire flow worked before this broader
review. The additional reliability changes above were verified with automated
tests and local browser fixtures. No live batch downloads, provider-by-provider
host checks, real IDM completion, browser-account sync transfers, or OS
notification delivery tests were performed in this review. Host markup,
verification requirements, and website availability remain external dependencies.

Reload the unpacked extension in Brave and confirm it shows version 4.4.1.
