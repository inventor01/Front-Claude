Latest full QA: [September 15 completion report](V26_FULL_QA_2026-09-15.md).

# Front v26 local QA — authenticated gate passed

Final validation: September 14, 2026. Branch: `v26-narrative-intelligence`.
Implementation commits: `8010a6c` and `927c820`.

The final authenticated scan completed in **4 minutes 31 seconds**, compared with the original failing scan's 18 minutes 36 seconds. The bridge remains running on43981 with the requested local profile. The existing authenticated Chrome session on43982 was preserved throughout.

## Final live result

Scan: `v26-1789386901377-6cyzbr`.

| Check | Result |
|---|---|
| Release validator | Passed; no failed checks |
| Final evidence | 77 canonical posts from74 creators |
| X | 27 posts; successful feed traversal |
| TikTok | 61 observed,50 grounded; broad discovery retained |
| Vision | 2 fresh model requests,0 failures;48.7s and37.1s |
| Usable visual evidence | 1 confident result;1 low-confidence result excluded from enrichment |
| Context | 12 modeled posts:9X and3TikTok;0 failures;41.4s total |
| Narrative ranking | Reached and completed |
| Promoted narratives | 0; no shared specific event established among the selected semantic frames |
| Origin | Correctly skipped because no candidates qualified; no second semantic pass |
| Evidence audit | Canonical URLs, creator diversity, no duplicate platform+URL pairs, no activity/notification leakage |
| Persistence | Completed scan persisted; ledger status and counts match |

Both stages use `qwen3-vl:4b-instruct`. Active profile: deep/scout/background visual budgets2/1/1;8 model frames;75-second deep vision deadline;12 contextual posts in batches of4;60-second context deadline;30-minute Ollama keep-alive with startup prewarm. These are analysis budgets, not discovery limits.

The final20-source sample contains10X and10TikTok posts. All20 canonical identities matched their source cards. Slow-loading TikTok captions were revisited after rendering. X excerpts preserve original and quoted post context; longer source pages can expand text truncated in the feed.

## Permanent repairs

| Root cause | Fix and regression coverage |
|---|---|
| X virtualized rendering stalls when its tab is hidden by simultaneous TikTok collection | Sequential primary collectors with independent full discovery budgets; accumulated IDs and per-scroll diagnostics. DOM and non-overlap tests. |
| X extraction selects an analytics link; stale counts terminate while scrolling still advances | Select the actual permalink; retain media-only canonical posts; require blocked movement before early exhaustion. Real DOM and movement tests. |
| Local model budgets and verbose responses exceed useful runtime | Requested2/1/12 profile, compact semantic and visual responses,8-frame contact sheets, real capture readiness, model-aware versioned caches. Full model latency measured live. |
| Unknown TikTok publication dates starve contextual analysis | Reserve a small contextual share per platform while keeping the same12-post limit. Mixed-platform selection test. |
| Aborted validator response turns known evidence into zero | Recover same-scan live/health/ledger; distinguish timeout,abort,running,internal failure,true zero and unavailable totals. Transport-state tests. |
| Unconditional origin pass analyzes unchanged evidence again | Analyze only newly discovered origin identities; preserve cumulative errors and per-request timing. No-change origin test. |
| Old origin age becomes current breakout age | Separate first Front observation, earliest evidence and current publication window. Old-origin/fresh-breakout test. |
| Slightly different semantic keys cannot be checked for equivalence | Bounded model adjudication of strongly overlapping semantic pairs; explicit same-story decision and confidence required. Positive,negative,low-confidence and cache tests. |
| Low-confidence visual response inflates enrichment count | Count only results meeting the existing confidence threshold as enriched. Regression and final live example. |

The earlier fruit-fly-brain-map pair was investigated explicitly. The adjudicator kept the mapping and simulation events separate; no narrative was forced into existence. Another intermediate scan did produce a candidate and completed both origin searches, processing only one new origin post afterward.

## Complete QA

- Bridge:164 tests passed.
- App:48 tests passed, including Settings/navigation and feed quality.
- SQL integration passed, including creation versus migration timestamp preservation.
- Migration generation had no schema drift; migrations applied to isolated persistent storage.
- Legacy v10/v16 and v17 content gateway health smokes passed on isolated ports.
- TypeScript, production build and deployment-bundle checks passed.
- Lint:0errors,29existing warnings.
- PumpPortal live test:22creation events and2migration events over45seconds,0socket errors. One test socket subscribed to both streams. The application listener is root-mounted; Settings does not own its lifecycle.

## Boundaries

The model intentionally examines a bounded subset of discovered posts. Low-confidence visual output is retained diagnostically but not promoted into evidence. Live feed composition and local inference latency can vary; failures remain explicit and the validator preserves partial evidence when interrupted.

Golden remains exactly `5701717964eab8caef3d3c86c12be358c2d7b55a`. No merge, deployment, force-push or Chrome restart occurred. Changes are committed locally; merge approval remains with the user.

Evidence: [final release report](v26-release-final.json), [full scan and ledger snapshot](v26-release-final-scan.json), [source review](v26-manual-review-sources.json), [PumpPortal live result](v26-pumpportal-live.json), [detailed investigation history](V26_RESUMED_QA.md), and [bug log](../../BUGLOG.md).
