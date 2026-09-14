# v26 resumed local QA — release gate pending

Start: branch `v26-narrative-intelligence`, clean HEAD `11e79b1fdc184901c3f58be5e4e8811d598e95d6`. Golden is read-only. No merge/deployment/push. Only bridge43981 restarted; authenticated Chrome43982 retained.

## Confirmed baseline

Latest pre-repair scan `v26-1789337424997-dg80qm`: 1116 seconds,64 evidence (X2/TikTok62), TikTok68observed,61creators,1semantic candidate. Visual1success/3failures; context4failures. Origin searched0 but second semantic pass processed36rows in333seconds. The validator499 report concealed those evidence totals.

## Repairs and evidence

| Symptom | Reproduction/root cause | Permanent change | Regression coverage |
|---|---|---|---|
| Aborted report shows zero | Validator reads only HTTP response evidence;499 has none | Recover same-scan live/health/ledger; distinguish running,timeout,abort,internal failure,true zero; unknown totals stay unknown | release-scan-state tests |
| Context repeats without origin | Unconditional deep-mode second pass even searched0 | Identify new origin IDs; process only new rows, preserve cumulative errors | analysis-priority tests |
| Excessive local model work | Runtime4/2visual,36context despite requested2/1,12 | Repository/startup/private profile updated;75svision,60scontext,4Bboth,8frames,30mkeepalive | runtime settings tests + live health |
| X premature exhaustion | Actual288px viewport,259px scroll, virtualized IDs; analytics link first; tall feed region crosses many scrolls | Choose actual permalink, retain media-only canonical rows; no swallowed DOM errors; accumulate IDs; early stop requires blocked movement and stale IDs;48scroll/70sbound | real DOM extractor and scroll tests; live traces |
| Old origin changes current lifecycle | Earliest evidence age used as breakout age | Separate first observation, earliest evidence, current72h publication window | old-origin/fresh-breakout regression |
| Expensive analysis ignores age | Visual ranking rewards weak captions without age; context takes feed order | Cheap freshness/repetition priority; >14day known publications excluded from vision only; unknown age remains unknown | priority tests |

Provider/model-aware visual cache already exists at this HEAD and its regression passes. PumpPortal root-mounted listener already subscribes to creation and migration on one socket. Backend migration update preserves creation data; added actual SQL integration assertions for separate migration timestamp and unchanged creation count.

## Static QA

First full checkpoint: bridge154/154, app48/48; SQL verification, TypeScript, production build pass. Lint0errors (existing warnings plus two extraction leftovers subsequently removed). Migration generation clean; migrations apply to isolated mounted persistence directory; deployment bundle includes hosting config and migrations. Legacy v10/v16 and v17 content gateway health smokes pass on separate temporary ports, with isolated data. No live Chrome control in legacy smokes.

Further patches require final rerun. Authenticated release gate is in progress and not yet approved. First current gate proved TikTok52grounded and exposed the remaining X stale-while-moving exit, which is now repaired for the next run. Model prewarm measured8495ms; current health confirms4Bboth,2/1visual,12context,8frames,75svision,30mkeepalive.

## Second repair checkpoint

- Hidden-tab controlled reproduction isolated the major X issue: six hidden scroll passes retained the same DOM IDs, bringing only the owned test page forward immediately refreshed them. Primary discovery now runs sequentially; each platform keeps its own full time/target budget. Regression proves no overlapping collector jobs and independent failure retention.
- Empty X shell capture no longer falls through after a fixed1.2s wait. Wait for media and require a rendered post for fallback; low-confidence responses cannot inflate enriched counts.
- Eight-panel contact sheet now uses224px-wide panels and retains numbered chronology; cache revision changed to avoid reusing old capture outputs.
- Semantic9-field verbose output exceeded60s at~6tokens/sec. Compact five-field response keeps subject/event/key/confidence and normalizes to the same public evidence schema. Real four-post test:17.8seconds,4modeled,0failed; the named Bloodhound Q50 event remained grounded in its source caption.
- Final static checkpoint:158/158bridge,48/48app; SQLincluding creation/migration timestamp preservation,TypeScript,lint0errors29warnings,productionbuild andbundle checks pass. No schema migration drift.
- Next live gate underway: X already12canonical posts at24scrolls, verifying useful feed penetration after sequential collection.

## Authenticated passing checkpoint and source audit

Scan `v26-1789355457168...` (exact ID in `v26-release-current.json`) completed in313581ms:78evidence,22X,56groundedTikTok from65observations. Both visual requests succeeded (61.8s/54.8s model time),12semantic rows succeeded in54.2s across3batches,zero model failures,ranking reached,origin legitimately searched0,ledger counts matched. All release checks passed. The prior18.6minute failing runtime fell to5minutes14seconds.

20 deterministic source samples were inspected:10X and10TikTok.19matched DOM cards initially; remaining X source was a quote post whose displayed title,author,caption and quoted text matched the collected evidence. Three TikTok captions needed additional rendering time; all were subsequently confirmed on the exact video pages. No notification/activity content or mismatched identities found in these samples. Source capture is in `v26-manual-review-sources.json`.

A separate45second PumpPortal connection subscribed to both lifecycle streams and received22creation and2migration events,zero socket errors (`v26-pumpportal-live.json`). SQL assertions independently verify migration cannot replace creation time or add a new creation record. The root-mounted application listener retains ownership across Settings navigation.

Two fruit-fly-brain-map semantic keys differed despite a shared subject. A bounded same-story adjudicator was added to investigate such strong semantic near matches, without using shared words as proof. On these real rows it returned same=false/confidence0.1 in11seconds: the captions describe mapping and simulation as distinct events. Zero promoted narratives was retained. Positive/negative/low-confidence decisions and unchanged-decision caching have regression coverage. Final bridge suite now162/162; all other checks remain passing. Final live rerun including this adjudicator is in progress.

## Final outcome — passed September14

Final scan `v26-1789386901377-6cyzbr`:270626ms,77evidence,27X,61TikTokobserved/50grounded,74creators. Visual2requests/0failures,1confident enrichment and1properly excluded low-confidence response. Semantic12modeled/0failures,9X+3TikTok,41.4seconds. Ranking complete,0narratives,origin correctly skipped,ledger agrees. Final bridge suite164/164 and all app/static checks pass. See V26_QA_REPORT.md for the current authoritative summary; earlier failures above are retained as the repair history.
