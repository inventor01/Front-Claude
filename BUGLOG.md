# Front Bug / Fix Log

## 2026-09-11 — Detection Engine v3 + single dashboard

### Root cause
Front had improved topic extraction, but the product still had several system-level gaps: the homepage stacked the new discovery dashboard above the older Desk dashboard, topic momentum mainly compared only the immediately previous scan, early two-creator lowercase narratives had no safe pre-breakout tier, topic history lived only on the Mac bridge, coin matching handled only a few fresh narratives inline, and automatic Pump.fun narrative launch matching stopped when the page/browser was closed.

### Permanent fix
- Remove the legacy Desk dashboard from the homepage so Front has one primary discovery dashboard.
- Add a `pre-breakout` tier for independently repeated two-creator terms without promoting them to Narrative Radar prematurely.
- Add multi-window momentum comparisons at 15m, 1h, 6h and 24h, with creator/evidence/platform deltas.
- Add conservative lexical/variant consolidation for near-identical names and highly overlapping multi-word phrases.
- Attach an earliest-sampled origin candidate to detected topics while explicitly avoiding an absolute-origin claim.
- Persist topic snapshots to the server so momentum/intelligence survives local browser restarts and can still be displayed when the bridge is offline.
- Queue coin matching for all promoted inferred narratives and process the queue in bounded batches instead of only matching three fresh cards.
- Add a standalone Railway PumpPortal watcher that subscribes only to `subscribeNewToken`, exact-matches active narrative aliases, and persists launch matches server-side even when the Front page is closed.
- Add a single unified dashboard stream that shows pre-breakout, candidate, accelerating and Radar states in one ranked list, with raw trend surfaces reduced to a smaller source-pulse section.
- Remove the duplicate page-level NarrativeCreationWatcher; explicit personal exact-name watches remain available in Live Intel while the automatic narrative watcher runs server-side.

### Regression gate
Detection tests now cover:
- two-creator lowercase pre-breakout behavior without automatic promotion,
- 15m and 1h momentum windows,
- earliest sampled origin evidence,
- Astra recovery,
- Daejon/Dejon variant clustering,
- 100 junk/UI/metric samples producing zero topics,
- mixed real-topic and one-off replay.

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
