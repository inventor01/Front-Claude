# v26 Transcript + Scan Signal Hardening

## Root causes

1. The authenticated release scan collected broad evidence successfully, but contextual post understanding degraded because 4-post / 900-token Ollama requests exceeded the 60s context deadline on the verified 8 GB Mac profile.
2. The active-scan Emerging Trends strip depended primarily on semantic fields, so useful repeated raw evidence could remain invisible until contextual modeling completed.
3. Completed scan ledger rows stored qualified topic counts but did not retain the lower-confidence WATCH / EARLY / RISING scan signals the live UI is intended to expose.
4. TikTok discovery captured captions and visual context, but did not preserve visible spoken-caption/subtitle fragments as a separate transcript signal for semantic understanding.

## Permanent fixes

- Hard-cap contextual semantic batches at 2 posts per request and cap local output at 400 tokens, even if an older private environment file still requests larger values.
- Reduce semantic prompt payload size while keeping the 12-post contextual budget.
- Capture TikTok visible subtitle/caption fragments and active text-track cues when the page exposes them; merge fragments across observer polls and preserve transcript provenance.
- Feed transcript text into semantic understanding as a separate grounded field and include it in cache fingerprints.
- Add conservative display-only raw repetition signals so the active scan can show EARLY / RISING before semantic modeling finishes. Raw signals cannot self-promote to QUALIFIED.
- Persist scan signals and status counts in the completed v26 scan ledger, along with transcript evidence counts and transcript snippets in stored samples.

## Safety / invariants

- Dashboard qualification remains unchanged: candidate tier + corroborated + at least 2 evidence rows + at least 2 independent creators (with the existing stronger one-word rule).
- Raw repeated-term signals are explicitly `corroborated: false` and therefore cannot reach the dashboard.
- TikTok personal/inbox/activity filtering remains intact.
- No new external transcription service, secret, or heavy speech-model dependency is introduced. Transcript capture is opportunistic from captions/subtitles/text tracks already rendered by the authenticated browser.
- Port ownership is unchanged: bridge 43981, authenticated Chrome CDP 43982.

## QA requirements

- Browser bridge unit tests must pass, including transcript merge, semantic batch hard-cap, timeout diagnostics, and scan-ledger signal persistence.
- App regressions must verify the live signal strip remains display-only and the scan ledger renders retained signal states.
- TypeScript, lint, production build, migration checks, D1 persistence, and deploy-bundle checks must all pass before advancing `v26-narrative-intelligence`.
