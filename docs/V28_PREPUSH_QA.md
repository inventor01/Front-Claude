# Front v28 Pre-Push QA

Date: 2026-09-16
Branch: `feature/v28-evidence-backed-titles`
Base: `main` at `f3f7da96cac7014ce8e436dbac6755a51c19a0b5`

## Focused local gate before code push
- `node --test test/*.test.mjs`: 10/10 passed, 0 failed.
- `node --check src/narrative-title-v28.mjs`: passed.
- `node --check src/narrative-intelligence-v26.mjs`: passed.
- Contract assertion: `titleIntelligenceVersion: 28` present while `intelligenceVersion: 26` remains unchanged.
- Policy assertion: `evidence-consensus-claim-verified` present.

## Covered regressions
- corroborated subject + event produces a specific title;
- one-creator event evidence is omitted rather than promoted;
- tied contradictory subject clusters are withheld;
- repeated posts from one author cannot fake corroboration;
- two-platform presence alone cannot trigger cross-platform wording;
- the event itself must exist on both platforms for cross-platform event wording;
- one-edit name variants such as DeJon/Daejon cluster safely;
- generic labels are rejected;
- integrated narratives expose confidence, consensus, evidence, candidates and title policy.

## Remote integrity verification
After upload, the six QA'd code/test/plan/buglog files were fetched from the feature branch and their Git blob SHAs were compared with `git hash-object` of the locally tested files. All matched exactly.

Repository-wide GitHub CI remains mandatory before merge.
