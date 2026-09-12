# Front Browser Bridge v21 — TikTok Breadth Fix

## Root cause

A deep scan was configured to seek roughly 90 unique feed items, but TikTok discovery had two independent gates that made the UI look stuck around four videos:

1. The primary TikTok extractor discarded DOM video links when TikTok did not expose usable caption text in embedded JSON, aria labels, titles, or image alt text. TikTok's virtualized feed can therefore show many real videos while only a small subset becomes semantic evidence.
2. Visual recovery then defaulted to only four deep video analyses. Caption-light videos that needed Qwen/Ollama could not become grounded evidence unless selected inside that four-video budget.

Raising the model budget to 90 would be the wrong fix because visual analysis is much more expensive than URL/card observation and is intentionally selective.

## Permanent fix

v21 adds a supervisor above v20 that observes every canonical TikTok `/@user/video/<id>` link visible in the authenticated Chrome context while a scan runs. Caption-light videos now count as **observed** immediately instead of disappearing. Grounded text evidence remains a separate set so empty/ambiguous videos are never promoted as facts.

The final scan merges newly grounded TikTok observations with v20 evidence using canonical URL deduplication. The live endpoint exposes `tiktokDiscovery.observed`, `grounded`, `target`, source pages, and observer errors. Deep visual understanding is raised from 4 to the top 8 ranked candidates; Scout uses 4. The existing Qwen cache/cooldown and narrative corroboration gates stay unchanged.

## Regression prevention

`test/tiktok-observation-v21.test.mjs` verifies that:

- 90 unique TikTok video URLs can be retained (no four-video ceiling).
- caption-light videos are counted as observed but not falsely grounded.
- later richer DOM metadata upgrades an earlier observation without resetting first-seen time.
- query-string variants canonicalize to one video.
- broad observations merge into final scan evidence without replacing richer visual analysis.

## Release gate

Automated tests and cloud deployment are necessary but not sufficient. The final certification must happen on the real Mac profile because TikTok DOM shape, login state, Chrome CDP, local Qwen/Ollama, and video playback are local-only dependencies.

Expected real-Mac validation:

1. Start `browser-bridge/start.command` and confirm health reports v21.
2. Run a deep scan with TikTok For You enabled and target 90.
3. During the scan, `/live` should show `tiktokDiscovery.observed` increasing beyond 4 even when some rows are caption-light.
4. Content health should show up to 8 selected deep videos, with successful timeline capture/Qwen analysis where available.
5. Final Scan Ledger should preserve observed/grounded counts and final evidence should sync to the live dashboard without duplicates.
