# Front v28 — Evidence-Backed Narrative Titles

## Objective
Make narrative titles more specific and trustworthy without weakening Front's v27 collection, transcription, video-meaning, post-understanding, narrative, origin, or release gates.

## Root cause
The current title picker ranks already-produced `postSubject`/topic strings by repetition, specificity, and shape. It does not require every displayed title claim to be independently corroborated, does not explicitly penalize contradictory subject clusters, and can imply cross-platform event spread from subject-level presence alone.

## Design
1. Keep v27 acquisition/transcription/video understanding unchanged.
2. Build title intelligence from structured post-understanding fields only: `postSubject`, `postEvent`, author, platform, and `postUnderstandingConfidence`.
3. Group near-identical subject/event phrases with conservative one-edit spelling tolerance for emerging names.
4. Require at least two independent creators for subject and event claims.
5. Detect competing subject clusters and suppress ambiguous titles instead of guessing.
6. Generate multiple title candidates from verified subject/event/cross-platform claims.
7. Reject candidates whose claims do not have independent evidence.
8. Add cross-platform wording only when the event itself is evidenced on both platforms and the cluster has enough independent spread.
9. Preserve the existing `intelligenceVersion: 26` contract; expose `titleIntelligenceVersion: 28` separately.
10. Attach inspectable title metadata: confidence, status, consensus, evidence IDs, creators, platforms, verified claims, candidates, and policy.

## Confidence behavior
- `specific`: high-confidence subject plus corroborated event.
- `conservative`: supported subject with weaker/absent event evidence.
- `provisional`: supported but lower-confidence title.
- unresolved contradictory clusters return no title and are not promoted rather than being guessed.

## Regression gate
Before pushing:
- title module syntax check;
- narrative integration syntax check;
- focused title-quality tests;
- integration-shape tests;
- no unsupported event promotion;
- no same-author fake corroboration;
- no cross-platform event claim from subject-only spread;
- spelling-variant recovery;
- generic label rejection.

After pushing the branch, GitHub CI must still pass the repository-wide browser bridge, typecheck, lint, build, migrations, security, persistence, and deploy-bundle gates before any merge.

## Authenticated release acceptance
The final v28 gate runs the full authenticated X/TikTok scan and then replays the real evidence through the v28 title verifier.

- The gate enforces the previously validated 20-minute minimum release window rather than the older 12-minute default.
- Timeout, transport, incomplete video meaning, incomplete post understanding, narrative/origin, ledger, canonical URL, notification leakage, and title-claim failures remain blocking.
- A sampled supplemental visual-understanding post may be uncapturable because a social page does not expose frames. That isolated visual-probe failure may be superseded only when **all other v27 checks pass**, including complete per-video semantic meaning and complete post/narrative stages. The waiver is recorded in the v28 report rather than hidden.
- The release passes only if the final title evidence gate also passes.
