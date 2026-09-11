# Front Bug / Fix Log

## 2026-09-11 — Narrative results regressed into basic TikTok hashtags

### Root cause
The detector was still treating hashtags as structured narrative evidence. A repeated hashtag received a high candidate weight, and hashtag text was also being re-read by the lowercase token/phrase extractor, so the same tag could effectively support itself twice. TikTok Creative Center/X Explore seed rows could also enter the topic detector even though they are discovery surfaces rather than independent creators. During detector-path merging, `authorCount` was additionally allowed to rise to the number of evidence IDs, which could make multiple posts look like multiple independent creators. Finally, persisted topic intelligence stayed active for seven days, so weak/stale topics could continue appearing long after the scan that produced them.

### Permanent fix
- Treat TikTok/X trend hashtags as search/discovery seeds, not automatic narrative labels.
- Strip hashtags before natural-language token/name/phrase extraction so one hashtag cannot count as both a hashtag and text corroboration.
- Exclude TikTok Creative Center and X Explore seed rows from independent-creator corroboration.
- Require non-hashtag natural-language creator support before a topic can enter pre-breakout/candidate state.
- Require stronger corroboration for one-word narratives while preserving early recovery for distinctive names such as `Astra`.
- Prefer repeated natural-language names/phrases over hashtag aliases when choosing the displayed narrative title.
- Reject platform boilerplate topics such as `fyp`, `viral`, `trending`, `capcut`, and similar tags again at the server promotion boundary.
- Stop inflating creator counts from evidence-count merges; creator count now remains creator count.
- Limit active topic-intelligence results to the last 48 hours while keeping older evidence/history available in the narrative workbench.

### Regression / release gate
The detector suite now includes hashtag-only TikTok replay, Creative Center seed isolation, Astra recovery, Daejon/Dejon clustering, narrative-phrase-over-hashtag ranking, UI/metric junk replay, momentum, and origin timing. The release must also pass migrations, mounted D1 persistence, typecheck, lint and production build.

## 2026-09-11 — Narrative rows lacked the full decision context

### Root cause
The unified dashboard restored the old Desk workflows, but the primary narrative row still acted mostly like a summary. To understand one narrative, the user still had to mentally combine momentum, evidence, related context, stored coin candidates, launch matches and timing from separate parts of the dashboard. That made the most important question — whether Front found a narrative early enough to create a trading edge — harder to answer than it should have been.

### Permanent fix
- Make the expanded Overview narrative row the primary Front workbench.
- Add a bounded `/api/narrative-detail` endpoint that lazily fetches heavy detail only for the narrative the user opens.
- Show Front's first stored detection time separately from the earliest sampled social evidence so detection time is not confused with an absolute internet-origin claim.
- Show 15m, 1h, 6h and 24h creator/evidence momentum plus recent snapshot history.
- Show the actual supporting X/TikTok evidence with creator, age, views, likes and direct source links.
- Show corroborated related context as repeated co-occurrence only, not a causal claim.
- Show stored related coins with price, liquidity, volume, market cap, Pump.fun and Axiom links.
- Show matching PumpPortal creation events inside the same narrative workbench.
- Compare Front's earliest stored detection timestamp with the first matching stored launch and label the result as before-launch, after-launch or still waiting.

### Regression / release gate
The release must pass the existing detection quality suite, browser bridge tests, migrations, mounted D1 persistence, typecheck, lint and production build before merge.

## 2026-09-11 — Unified dashboard lost old Desk usability

### Root cause
The first consolidation removed the legacy Desk from the homepage but did not migrate enough of its useful workflows into the replacement dashboard. That made the page visually simpler while losing important day-to-day usability: stored Radar narratives were not merged into the main narrative list when the newest detector set was empty, related coin candidates were hidden in a separate manager, delete controls were not available where items were viewed, there was no compact/collapsible browsing mode, and the single funnel mixed current-scan counts with persistent historical Radar counts. A state such as `390 collected → 347 usable → 0 topics → 38 radar → 0 coin checks queued` therefore looked internally contradictory even though the 38 Radar narratives were persisted from earlier scans and a queue count of zero could simply mean no checks were waiting.

### Permanent fix
- Merge fresh topic detections with all stored Radar narratives into one ranked narrative workspace so stored intelligence stays visible even when the newest scan has zero fresh topics.
- Put stored related-coin candidates directly on narrative rows and add a dedicated Coins view with narrative/ticker/mint search, Pump.fun links, Axiom links and watchlist actions.
- Add persistent dashboard dismissals for raw/early signals and unpromoted topic rows without deleting the underlying social evidence.
- Add direct deletion for Radar narratives, stored narrative-coin candidates and stored launch matches.
- Add row expansion for aliases, related context, origin evidence and coin details.
- Add compact/comfortable density controls, whole-dashboard collapse, and Show More / Show All controls instead of forcing one fixed long layout.
- Split the old misleading funnel into `CURRENT SCAN` and `STORED INTELLIGENCE` lanes, and show waiting versus completed coin checks separately.
- Remove the redundant floating Radar Manager from the homepage because its primary delete/rematch/coin-inspection actions now live in the main dashboard.

### Regression / release gate
The release must still pass migrations, D1 persistence, unit tests, browser bridge tests, typecheck, lint and production build before merge.

## 2026-09-11 — Plain-word early-candidate leak

### Root cause
The high-recall lowercase recovery path treated every non-stopword token as a possible topic. That was useful for recovering emerging names such as `astra`, but common conversational words that were not in the original stoplist could still become Early Candidates when two or three independent posts happened to reuse them. Proper-Case extraction also made sentence-level words such as `Blue` or `Trade` look more entity-like than they really were.

### Permanent fix
- Add a dedicated common single-word topic filter shared conceptually by the browser detector and server Early Candidate builder.
- Reject generic standalone conversational, color, action, commerce, UI and social words before they enter candidate buckets.
- Do not treat a one-word Proper-Case match as structured evidence merely because it is capitalized.
- Keep specific multi-word names/phrases eligible even when they contain a common word, so a narrative such as `Blue Smurf Cat` can still surface while bare `Blue` cannot.
- Preserve high-recall recovery for distinctive lowercase terms such as `astra`.

### Regression gate
Detection tests now explicitly replay repeated `never`, `Blue`, `Trade`, and `someone` across multiple independent creators and require all four to stay out of the topic stream while a repeated specific phrase still surfaces.

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