# Front v28 Title Intelligence Bug / Fix Log

## 2026-09-16 — Narrative titles could sound more certain than the evidence

### Root cause
The v26 title selector scored candidate strings using repetition, lexical specificity, and title length. That was useful for rejecting generic hashtag-style labels, but it did not prove every displayed claim. A repeated subject could dominate even when an event description was weak or contradictory, and platform presence at the subject level was not the same as proof that the same event was spreading on both platforms.

### Permanent fix
- Add a dedicated `narrative-title-v28` evidence-consensus layer after post understanding.
- Require independent creator corroboration for the displayed subject and any displayed event.
- Penalize/withhold titles when competing subject clusters are too close to call.
- Preserve conservative one-edit spelling-variant grouping for emerging names such as DeJon/Daejon.
- Generate and rank multiple candidates, but only from pre-verified claims.
- Keep cross-platform wording out unless the event itself is represented across multiple platforms with sufficient independent spread.
- Expose title confidence, status, consensus, evidence IDs, creators, platforms, claim list, alternatives, and policy in the narrative object.
- Preserve the existing narrative intelligence contract version (`26`) and version the title subsystem independently (`28`).

### Regression / release gate
Focused pre-push QA covers: specific corroborated title generation; weak-event omission; contradictory-subject rejection; same-author repetition rejection; conservative cross-platform behavior; event-specific cross-platform verification; one-edit spelling variants; generic-label rejection; and integration metadata shape. Repository-wide CI remains mandatory after branch push and before merge.

## 2026-09-16 — Release process did not verify v28 title claims on authenticated scan output

### Root cause
The existing authenticated v27 release gate verifies browser auth, X/TikTok discovery, transcripts, visual understanding, video meaning, post understanding, narrative/origin completion, canonical URLs, persistence, tests, and build health. It did not inspect v28-specific title metadata or independently fail a release when a displayed title claim lacked the supporting creators/platforms declared by the new title policy.

### Permanent fix
- Add `title-release-gate-v28.mjs` to verify emitted/replayed narrative title metadata and evidence claims.
- Require exactly one independently corroborated subject claim for every displayed v28 title.
- Require every displayed event claim to have at least two independent creators.
- Require cross-platform wording to have an explicit cross-platform claim, at least two represented platforms, independent creator support, and three-creator overall consensus.
- Verify title evidence IDs contain the evidence IDs referenced by displayed claims.
- Accept conservative subject-only titles when their subject claim is independently corroborated.
- Treat a scan with no qualifying narrative as neutral rather than a false software failure; unsupported emitted claims still fail the gate.
- Add `validate:v28-release`, which runs the full authenticated v27 gate first and then validates v28 emitted titles plus a replay of title intelligence over the authenticated scan evidence.

### Regression / release gate
The v28 release checker has dedicated tests for valid corroborated titles, unsupported cross-platform wording, one-creator event claims, conservative subject-only fallback, no-trend scans, and failure propagation from replayed or emitted invalid titles. The exact PR head must also pass the full repository CI before the authenticated Mac release gate is accepted.

## 2026-09-16 — First authenticated v28 run aborted before semantic completion

### Root cause
The first real v28 authenticated run used the v27 wrapper default of 720 seconds even though the previously validated full local release run used a 20-minute window. The validator aborted while the live scan was still in `video-meaning`, producing a 499 validator abort even though discovery and 68/68 transcription had completed. The same run also sampled one supplemental visual-understanding post whose page yielded no capturable frame. That random visual probe marked the visual stage degraded even though it is not the final per-video semantic acceptance layer.

### Permanent fix
- Add `release-gate-v28.mjs` and enforce a 1,200,000 ms minimum authenticated release deadline for v28.
- Never waive timeout, transport, incomplete video-meaning, incomplete post-understanding, narrative/origin, ledger, canonical-URL, leakage, or other v27 failures.
- Permit v28 to continue past a v27 nonzero exit only when **every** v27 failure is limited to the supplemental sampled visual-probe checks.
- Keep the stronger end-to-end requirements intact: every collected video must reach semantic meaning, post understanding must complete without failures, narrative/origin stages must complete, and the v28 title evidence gate must pass.
- Record any waived supplemental visual-probe checks in the v28 release report rather than hiding them.

### Regression / release gate
Pre-push tests verify the 20-minute minimum, normal green-base acceptance, visual-probe-only supersession, and—critically—that timeout or incomplete semantic-pipeline failures can never be waived. The updated v28 script also passes Node syntax checking before push.
