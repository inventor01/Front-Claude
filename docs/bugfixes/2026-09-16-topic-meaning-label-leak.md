# Topic labels displayed as `meaning`

**Date:** 2026-09-16  
**Area:** Front v28 narrative/topic intelligence  
**Severity:** User-facing correctness regression

## Root cause

The v28 narrative-title classifier considered a one-word semantic field value such as `meaning` to be a specific subject because it was long enough and was not present in the generic-label filters. The same internal metadata vocabulary was also accepted by topic repair and scan-signal merging, so `meaning` could survive as a topic title. Persisted snapshot reads had no final read-time guard, allowing stale bad labels to remain visible after the originating scan.

## Permanent fix

- Added a shared browser-bridge semantic-label guard for internal field names such as `meaning`, `subject`, `event`, `analysis`, `semantic`, `topic`, `title`, and related container-only phrases.
- Applied the guard to v28 narrative-title subject/event selection.
- Applied it to topic detection, topic snapshots, raw-term extraction, qualification, and semantic scan-signal merging.
- When an old topic contains an internal label but has a concrete key or semantic subject, the concrete label now replaces the internal placeholder.
- Added a server-side `/api/topic-intel` read guard so stale persisted rows are repaired from a concrete key when possible or omitted when both title and key are internal metadata.

## Regression coverage

Focused tests cover:

- `meaning`, `subject`, `event`, `analysis`, `semantic meaning`, and `content analysis` never becoming narrative titles.
- Concrete subjects such as `DeJon Love meme` remaining valid.
- A stale `meaning` topic being replaced by the concrete semantic subject.
- Meaning-only semantic rows being dropped rather than rendered.
- Internal-label topics never qualifying as scan signals.
