# Front Bug / Fix Log

## 2026-09-11 — Detection Engine v2

### Root cause
Front was previously too close to a text scraper: social feed/search captions could become candidate labels directly, while topic inference relied heavily on hashtags, Proper Case phrases, and within-scan counts. This created two failure modes at once: UI/metric/user text could leak into displayed topics, and real lowercase narratives such as `astra` could be missed until they became obvious.

### Permanent fix
- Keep feed/search posts as evidence; do not display whole captions as topics.
- Require platform-native post/caption extraction. X no longer falls back to whole-card text; TikTok no longer uses visible view-count anchor text.
- Add Detection Engine v2 clustering for hashtags, named entities, repeated lowercase tokens, and repeated two/three-word phrases.
- Require independent creator corroboration for weak/unstructured terms.
- Conservatively consolidate formatting and one-character spelling variants when evidence overlaps.
- Persist a rolling seven-day local topic history and calculate scan-to-scan creator/evidence/platform growth.
- Rank live detections by momentum before raw popularity.
- Expose the evidence and reason for each live topic on the main discovery dashboard.

### Regression gate
`browser-bridge/test/detection-engine-v2.test.mjs` includes a replayable quality suite covering:
- `Astra` recovery from lowercase independent mentions.
- Daejon/Dejon wording variants.
- scan-to-scan acceleration.
- 100 UI/metric/notification junk samples producing zero topics.
- mixed real-topic + one-off-noise replay.

A release should not merge if this quality gate or the existing browser bridge, build, migration, lint, or typecheck gates fail.
