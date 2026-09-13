# Front v26 QA — in progress, not approved

Starting HEAD: fe4b49d3738acbeaf0733fca04fb18ce4c45f932
Golden: 5701717964eab8caef3d3c86c12be358c2d7b55a

Initial worktree clean; remote v26 matched HEAD after fetch; merge base equals Golden. Golden was read only. No merge, push, deploy or Chrome restart.

## Golden comparison

| Area | Classification | Finding |
|---|---|---|
| CDP compatibility preload | Intentional reliability improvement | Healthy attachment; retained unchanged. |
| Start script model budget / explicit overrides | Required v26 feature | Preserved; startup sources local content settings. |
| Single-process server and owned pages | Intentional reliability baseline | Preserved architecture. |
| Progressive live evidence | Intentional improvement | Retained; final evidence must not be truncated before ledger totals. |
| TikTok strict local container exclusions | Intentional safety improvement | Retained. Actual inbox anchors are excluded correctly. |
| TikTok anchor-only identity | Confirmed acquisition incompatibility shared with Golden | Real current feed uses player ID plus local author link. Golden broad fallback could ingest the 10 inbox links. |
| TikTok window scroll | Confirmed acquisition bug shared with Golden | Current feed uses nested scrolling element. |
| Origin parent fallback | Confirmed contamination risk shared with Golden | Replaced by same constrained extractor as discovery. |
| v26 contextual model and narrative metadata | Required v26 feature | Retained; hardened malformed responses/cache and semantic gate. |
| Legacy lexical narratives appended to semantic results | Confirmed v26 requirement violation | Lexical candidates no longer bypass semantic corroboration. |
| Separate v26 ledger | Intentional improvement with schema gap | Canonical v26 audit fields now persisted directly. |
| Content navigation | Confirmed poisoned-input path shared with Golden | Absolute supported social post validation at selection/capture. |
| Coin observations, matching and creation-only routing | Intentional improvement | App/SQL regressions passed; backend matching untouched. |
| Related coin age render | Confirmed v26 lint regression | Effect-driven clock; lint now zero errors. |

## Evidence

The initial stalled scan snapshot is saved alongside this report. Browser probes found:
- Existing Chrome responds and Playwright attaches to one authenticated context.
- Every observed `/video/` anchor in the failing TikTok DOM was inside an inbox list item.
- Actual feed cards had `xgwrapper-<index>-<videoId>`, local avatar author links, caption nodes and video/canvas media.
- Current scrolling container: 2391px content in a 288px viewport, overflow scroll; window is not the feed scroller.
- Revised extractor produced two exact real video identities in a diagnostic tab, without admitting any inbox link. This alone does not establish release success.

## Validation so far

Baseline bridge: 126/126. Expanded bridge: 134/134 at intermediate checkpoint; additional changes require final rerun.
App tests: 43/43. SQL integration verification: passed, including creation-only routing and market-cap baseline assertions.
Production builds: passed. Typecheck: passed. Lint: 0 errors, 29 warnings after coin clock fix.

Release gate has not passed. Final live scan, Qwen, contextual quality, origin, full ledger and manual evidence review remain required. See BUGLOG for each repair and regression coverage.
