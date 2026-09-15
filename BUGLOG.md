# Front Bug / Fix Log

## 2026-09-11 — Ranking could not learn from verified outcomes

### Root cause
Front's detector and cleanup gates had become much stricter, but the final priority score was still a fixed hand-written formula. The existing `learning_archive` only preserved reset summaries, so useful human judgments and real post-detection outcomes were not feeding back into future ranking. Simply letting Front train on its own predictions would create a dangerous self-reinforcing loop: a bad signal could rank highly, be treated as a success because Front ranked it highly, and then receive even more weight.

### Permanent fix
- Keep narrative extraction, junk rejection, independent-creator corroboration and semantic cross-platform quality gates fixed; the learning system cannot relax them.
- Reuse the private `learning_archive` as an append-only source of explicit relevance feedback and externally verified outcomes instead of creating another database silo.
- Add `Useful` / `Not relevant` feedback to the expanded Front Desk narrative view. One current label is stored per narrative and can be changed later.
- Learn only from early social-signal features: cross-platform presence, same-event X↔TikTok corroboration, cross-post repetition, 3+ independent creators, acceleration, fast engagement, 50K/100K hourly velocity and freshness under three hours. Coin presence is deliberately excluded from the feature vector.
- Treat human feedback as the strongest supervision. A verified PumpPortal `subscribeNewToken` creation observed after Front detected the narrative is a weak positive label; later $25K, $100K and $500K market-cap thresholds add progressively stronger external outcome evidence.
- Require at least five comparable examples for a feature before it can affect ranking, increase confidence gradually through twenty examples, and cap the total learned adjustment to ±15 priority points.
- Keep automatic coin-outcome rewards materially weaker than explicit human feedback so one lucky launch cannot teach Front a bad general rule.
- Show the learned adjustment and the signal patterns responsible for it so every adaptive ranking change remains inspectable.
- Preserve the learning archive when `Clear & new scan` resets active evidence/results.

### Regression / release gate
The release adds a dedicated learning regression suite that verifies: no adjustment before the minimum sample size; useful feedback raises similar qualified signals; not-relevant feedback lowers them; verified coin creation is weaker than human feedback; market outcomes cannot create unbounded adjustments; and unrelated archive records cannot train the ranker. The full migration, browser scanner, mounted D1 persistence, typecheck, lint and production build gates must also pass.

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
- mixed real-topic and one-off-noise replay.

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

## 2026-09-12 — TikTok discovery regressed to personal/activity content

### Root cause
The v26 branch was created from the Golden v25 checkpoint before the TikTok feed-card-only isolation fixes were incorporated. The observer used a broad DOM ancestor fallback that accidentally climbed into profile, activity, and notification containers, causing personal content to be scanned as discovery evidence.

### Permanent fix
- Updated `browser-bridge/src/tiktok-observer-v21.mjs` to use a strict allow-list of feed/discovery containers: `[data-e2e*="recommend-list-item-container"], [data-e2e*="search-card"], [data-e2e*="recommend-item"], [data-e2e*="feed-item"], article`.
- Removed the broad parent-climbing fallback.
- Verified that TikTok discovery now exclusively grounds actual feed/discovery cards.

## 2026-09-12 — Current Scan box looked empty during active discovery

### Root cause
The UI in `app/front-live-shell.tsx` relied on top-level `live.observed` and `live.evidence` arrays. While the backend was actively finding posts via the TikTok observer, the top-level counts were not updated until the discovery phase finished and grounded evidence was merged.

### Permanent fix
- Modified `server-v25.mjs` to dynamically compute the total `observed` count and `platformCounts` in the `/live` endpoint by combining the X discovery state with the real-time snapshot from the `BroadTikTokObserver`.
- This ensures the UI shows "Observed: X" and "TikTok: Y" immediately as the scanner progresses.

## 2026-09-12 — Discovery evidence only appeared after scan completion

### Root cause
The scanner waited for the entire discovery phase (both X and TikTok) to complete before exposing the grounded evidence array to the `/live` endpoint.

### Permanent fix
- Implemented progressive grounded evidence streaming in `server-v25.mjs`.
- In `collectXFeed` and `collectTikTokFeed`, discovered grounded evidence is now merged into `latestLive.evidence` immediately during the polling loop.
- The UI now displays evidence cards progressively as they are found, while keeping them separate from the final narrative intelligence gates.

### Regression / release gate
Verified that:
1. TikTok discovery excludes personal/profile/activity rows.
2. Current Scan UI updates counts live during discovery.
3. Grounded evidence streams progressively to the UI.
4. Full unit test suite passes (except for environment-blocked loopback tests).

## 2026-09-13 — Related coin tracking and false association repair

- Root cause: alias containment was symmetric, so a partial token name such as Agent qualified against Coding Agent. Require the complete phrase in the coin name, reject generic singleton aliases and require multiple distinctive terms for overlap. Revalidate old links and preserve their historical snapshots when rejected.
- Root cause: enrichment replaced data on every refresh, coercing missing values to zero and falling back from MC to FDV. Preserve immutable first/match baselines, keep unavailable MC null, keep FDV separate, and atomically append coin_market_snapshots with current records. Never assign a later quote to an unknown match-time baseline.
- Retain unmatched PumpPortal create events for later narrative discovery. Add independently labeled discovery of direct Pump.fun pools; never fabricate a creation event from a search result. Cache queries and mint requests; rank semantic confidence before traction.
- Add shared related-coin detail cards, all three mint-based links, Copy CA, window metrics, momentum, timing and explicit PRE-COIN states. Background enrichment proceeds separately from scan completion and rotates through narrative pages.
- Persist exact launch timestamps only when verified; creation-event observation and pool-creation times remain distinct. SOL-denominated event market caps are not labeled USD. Unknown holder/curve data remain unavailable.
- Integration also preserved remote v26 feed protections and live counters. Fixed pre-existing invalid escaped template delimiters in the local scanner source; added syntax regression coverage. Updated counter-layout/copy assertions to the combined current UI while retaining polling and feed-protection assertions.

## 2026-09-13 — v26 full pipeline QA (release validation pending)

- **TikTok anchorless feed / wrong scroll surface:** authenticated probes reproduced 10 `/video/` anchors, all inside `inbox-list-item`, while real `recommend-list-item-container` cards exposed `xgwrapper-<index>-<videoId>` and a local `video-author-avatar` link. The prior diagnosis incorrectly treated the inbox links as feed links. Golden also depended on anchors, so reverting would restore contamination rather than acquire this DOM. Added card-local identity extraction and caption-only text extraction; retained personal-surface exclusions. The feed's parent is a scrollable div (2391px content / 288px viewport); window scrolling cannot advance it. Scroll that ancestor. Regression: real Chromium DOM fixtures cover anchorless identity, persistent inbox shells, local activity, and unknown parents. Live release validation pending.
- **Origin collector broad ancestor fallback:** source inspection confirmed `parentElement.parentElement.parentElement` still admitted unrelated page content. Both Golden and v26 had the unsafe fallback. Origin now reuses the same constrained TikTok extractor with explicit investigation provenance. Regression: shared DOM extraction tests. Live search validation pending.
- **Malformed media navigation:** reproduced `selectVideoCandidates` selecting the literal `chmod +x browser-bridge/start.command`. Golden/v26 capture passed row.url directly to goto. Added absolute HTTP(S), exact supported host and post-path validation at selection and capture; collectors canonicalize through the same validator. Regression: poison, credentials, unsupported hosts/protocols, malformed paths, platform mismatch, canonical URLs. Existing candidate diversity fixture updated from impossible one-digit TikTok IDs to valid IDs without changing assertions. Live model validation pending.
- **Incomplete ledger schema:** writer omitted usable evidence, complete creator/source counts and canonical vision/context fields; UI inferred these from at most 30 samples. Added versioned ledger builder with full evidence counts and model/stage metadata. Regression: 40-row fixture verifies totals beyond sample truncation. Live persistence validation pending.
- **Legacy narrative bypass:** reproduced a lexical Office Opening candidate with no semantic key being returned by v26. Legacy candidates now contribute metadata only to semantically corroborated narratives; model key, subject, confidence and independent creator gates remain mandatory. Regression covers bypass, low confidence and repeated single creator. Live quality review pending.
- **Context cache / silent parse failure:** malformed model JSON previously fell back with zero failures; fallback frames were then reused as successful cache entries, and richer visual input did not invalidate cache. Added per-row indexed response validation, failure counts, retryable fallback and input/model fingerprinting. Regression supplies malformed JSON and changed visual input. Live model validation pending.
- **Coin age impure render:** lint reproduced Date.now during render in new related-coin UI (absent in Golden). Moved the clock to an effect-driven interval with cleanup. Typecheck and lint revalidation pending; coin matching and market-cap logic unchanged.

Baseline before edits: bridge 126/126; production build passed. App regressions 43/43 and SQL/coin verification passed. Golden remains `5701717964eab8caef3d3c86c12be358c2d7b55a`. No merge/deployment performed. CDP 43982 was not restarted.

- **X/origin hidden-tab wheel deadlock:** live scan stayed at X=1, scrolls=0 while TikTok advanced to 24 observed/22 grounded. Isolated reproduction: hidden X `mouse.wheel` did not resolve within 3 seconds; DOM scrolling immediately changed scrollY from 0 to 950. Golden used the same wheel path. Replaced wheel dispatch with direct scrolling of the actual scrollable ancestor/root; origin searches use the same helper. Regression exercises nested and document surfaces in real Chromium. Live revalidation pending.
- **Validator readiness and lifecycle:** raw TikTok anchors were exclusively inbox links; required card-local extraction readiness now replaces duplicated anchor filtering. Player elements alone can precede author hydration, so readiness requires a complete normalized observation. Validator exits its own process after completion (prior failures left CDP client processes running); it never closes the authenticated browser. Final scan payload is retained for manual review.

- **Qwen context overflow and shared deadline:** real diagnostic captured 16 frames in 9.8s, then Ollama rejected 13,199 tokens against its 4,096-token window. A chronological timestamped contact sheet preserves 12 model-selected timeline frames in one image; the corrected request is 2,520 tokens. Decode video frames directly with a bounded screenshot fallback. Inference deadline starts after capture. Regression covers sheet dimensions/frame count and capture/deadline independence. **Not release-validated:** corrected request still times out during image encoding on this memory-constrained host; see docs/qa/V26_OLLAMA_FINDINGS.md.
- **False success / overwritten errors:** nonempty evidence previously caused complete/ok even with degraded stages; the second context pass could overwrite earlier failures. Final outcome now incorporates stage failures and empty requested collectors; context pass totals preserve earlier failures. Regression covers nonempty evidence with failures, disabled versus empty requested sources, and manual stop.
- **Repeated visual enrichment:** applying cache twice appended the same generated text again. Preserve sourceContent and build enrichment from it; regression proves idempotence.
- **Creator independence:** same handle across platforms, or absent author fields, must not create independent corroboration. Conservative normalized-handle gate now excludes both; regression added.

## v26 resumed QA: runtime and X diagnosis (2026-09-13)
Before edits: clean HEAD 11e79b1, v26 branch. Latest ledger scan dg80qm retained 64 evidence (X2/TikTok62), duration1116059ms, visual1success/3failures, semantic4failures. Origin searched0 yet unconditional second context call processed36 more rows (333s). Validator reads evidence only from aborted response, losing live evidence on499. Root fixes: restrict origin contextualization to newly added identities, use target2/1/12 model budgets, preserve snapshots and distinguish transport failures.
Live owned X diagnostic: For You selected, viewport288px, scroll moves259px each attempt, virtualized IDs change. First status link for valid textual post is /status/2082496145994248488/analytics; extractor chooses first link then rejects it instead of actual timestamp permalink. Other cards are media-only and rejected for absent text. Four stale accepted-row passes can stop while feed itself advances. Fix must select canonical permalink, preserve grounded media cards, and measure stale discovery IDs independently from accepted text rows. Chrome session untouched; temporary diagnostic page closed individually.

Live follow-up: the first repaired gate still stopped X at1 after8 scrolls. Its retained diagnostics prove every scroll moved259px (0→2072), with only3 DOM IDs through a tall feed region. Counting unchanged IDs alone still mistakes traversal for exhaustion. Root fix: require both repeated unchanged IDs AND blocked scroll movement before early termination; retain48-scroll/70-second bounds. This does not lower evidence or narrative quality gates.

Age audit reproduction: measureNarrativeVelocity currently calculates age and recency from the earliest related evidence, then lifecycleForNarrative marks age>72h SATURATED regardless a fresh corroborated burst. Thus adding old origin evidence changes current-breakout classification. Fix: retain earliest evidence/age as history, separately expose first Front observation and the current72-hour publication window; use that window's age for lifecycle/recency when it exists. Unknown publication is not manufactured from observation.

Hidden-tab reproduction confirmed: same owned X page visibility=hidden, scroll259→1813, identical rendered IDs for6passes; activating only that owned page immediately replaced virtualized IDs at2072. Parallel X/TikTok page creation hides X while TikTok owns active tab. Permanent fix is sequential primary collection on the existing context, each with unchanged independent discovery budgets. No browser flag/profile/port changes. Also visual capture slept1.2s then screenshot a blank X shell; confidence0.1 was counted as enriched despite applyUnderstanding rejecting it. Require rendered media readiness, crop fallback to actual post, and count enrichment only at existing0.5 confidence threshold. Contact sheet costs2172prompttokens for8frames and timed out75s; reduce panel pixel dimensions while retaining all8 chronological frames and text labels, then validate quality/model runtime.

Semantic timeout reproduction: all3four-post requests exceeded60s; Ollama logs show generation at~6tokens/sec and313–347tokens emitted before cancellation, so this is output latency, not a hung collector. The9-field frame repeats subject/event in action/object/context and narrativeKey. Keep required semantic subject,event,key,confidence, but use compact wire keys and short phrases; normalize back to the public frame. Do not truncate token budgets or relax confidence/corroboration. Regression accepts compact output and retains legacy structured responses. Per-request elapsed/batch/timeout/error diagnostics added.

Final quality audit: the passing78-row scan contained two independent model-understood fruit-fly-brain-map posts, keyed `google fruit fly brain map` and `ai fruit fly brain map`. deriveSemanticNarrativesV26 buckets only exact keys, so even strongly overlapping semantic identities cannot be checked for equivalence. Root fix: bounded semantic alias adjudication for at most3pairs sharing at least4specific semantic-key terms; a model must explicitly confirm the same concrete story with>=0.85confidence. Lexical overlap only nominates pairs, never promotes or merges them. Different events, generic words, same creators, and ambiguous responses remain separate. Preserve existing creator and confidence gates; cache decisions to avoid repeated unchanged analysis.

Final repeatability gate (29X/42TikTok) exposed visual output latency: first request spent35.5sprompt+35.7sgenerating249tokens; second reached only135generated tokens at~4tokens/sec before75stimeout. Image decoding succeeded, so collector/capture is not the cause. Apply the proven compact-wire approach to visual output too: concise grounded summary,event,entities,visible text,confidence,uncertainty and meme score; keep8frames and75sdeadline. Omit redundant action/motif prose (event/summary retain visible actions). Normalize to existing public fields and version the cache. Failures now also return elapsed capture/model times rather than null diagnostics.

Selection audit found a coverage gap: all12semantic selections in the passing scan were X posts because X exposes publication time while TikTok leaves it unknown. A35-point recency difference makes even repeated TikTok captions lose every slot. Preserve the12-post budget and freshness ranking, but reserve a small share (3of12when both platforms exist) for each discovered platform before filling remaining slots by priority. This changes analysis selection, never discovery volume or inferred publication dates. Regression verifies mixed-platform coverage within the same budget.

## Post-push repeatability: collector page loses visibility
Reproduced a1-post X scan with39successful DOM scrolls but the same2rendered IDs. A separate owned-page probe became hidden after3passes and its virtualized IDs froze. Sequential platforms prevent mutual hiding but do not guarantee continued page visibility. Root fix: check visibility of the owned X collector before each extraction, activate only that owned page when hidden, and report visibility recovery/failure. No Chrome process/profile/port changes. Also /live exposed the previous TikTok observer counts while the new scan's TikTok stage was pending; use the current pending/disabled stage until the observer starts. Regression covers recovery and pending-counter isolation.

TikTok follow-up: scan 4ap844 retained only2 identities after78 scrolls; an owned hidden-page reproduction repeatedly returned no identities. Apply the same owned-page visibility guard to TikTok polling and authenticated release probes; preserve the failed run and unchanged evidence requirements.

Visible-both scan vop3wg:96posts (36X/60TikTok), context succeeds, visual second request times out75s. Ollama task245 processed1519prompttokens, generated100tokens at2.4tokens/sec before cancellation; capture took9.1s and succeeded. Reduce repetitive visual instruction text and requested prose lengths while preserving8frames, grounded entity/text/uncertainty fields, confidence gates, and75s model deadline. Version cache so validation uses the new prompt.

## Full QA completion, September 15
Restarted f925ccf gate retained100posts (39X/61TikTok), but visual item ArchiveExplorer/2099526750656933987 exceeded75s and context returned10valid frames for12inputs while all6requests reported complete with no errors. Root causes: unconstrained context output can omit/mistype indexed rows and request success is counted before row validation; portrait contact sheets retain substantial image-token overhead despite concise prompts. Enforce compact Ollama response schemas, report missing/invalid indexed rows as request errors, and reduce contact-sheet panel size from224to168pixels while preserving8chronological frames andconfidence gates. Cache versions must change; fresh live validation must exercise new outputs.

Final semantic review of passing8dei6o scan found generated frame labels (`1: 0.0s`, `2: 13.1s`) in onScreenText. They are collector annotations, not source content. Filter annotation-shaped entries only for contact sheets, instruct the model to ignore panel labels, and invalidate visual cache. Preserve genuine caption text and non-contact-sheet time text. Regression covers both paths.
