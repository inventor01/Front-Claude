# FRONT v26 Understanding Layer Hardening

## Root causes addressed

1. A post could be reduced to a semantic subject/key without retaining why Front believed it.
2. Weak evidence disappeared between scans, so one creator in scan A plus another in scan B could never accumulate into a useful early signal.
3. Future reply/comment ingestion could accidentally count a comment swarm like independent top-level spread.
4. Creator claims about origin could be mistaken for verified facts or silently conflict with each other.
5. Old narrative memory could leak into an unrelated scan if historical support was not tied back to evidence seen in the current scan.

## Permanent design changes

### Auditable understanding frame
Each ledger evidence sample can now retain a versioned `understandingFrame` with:
- subject / event / entities / semantic key
- event fingerprint
- per-channel confidence
- source provenance
- observed vs inferred vs claimed vs verified evidence buckets
- transcript status and fallback need
- uncertainty flags
- origin claims

No creator/platform claim is automatically marked verified.

### Narrative memory
Completed scans update `narrative-memory-v26.json` under `FRONT_BRIDGE_DATA` (or the normal local bridge data directory).

Decay policy:
- 0–6h: 1.00
- 6–24h: 0.90
- 1–3d: 0.70
- 3–7d: 0.40
- 7–14d: 0.15
- >14d: historical only / zero momentum weight

Memory is display/support intelligence only. It cannot set `corroborated=true`, cannot create `tier=candidate`, and cannot produce `QUALIFIED` by itself.

A memory-backed signal is only attached to a scan when that narrative has at least one evidence item in the current scan. Old memory cannot make an unrelated scan appear to contain a topic.

Failed/stopped scans do not teach long-term narrative memory.

### Creator independence
The same normalized handle is one creator even if it appears on both X and TikTok.

### Reply/comment safety
Supporting social context is normalized separately:
- top-level post weight: 1.0
- quote/repost with commentary: 0.7
- reply/comment: 0.3

Only top-level creators satisfy the rolling-memory independence thresholds for `EARLY` / `RISING`. Comments can add context and momentum evidence but cannot manufacture independent spread.

Generic reactions, emoji-only comments, bare links/handles, and duplicate comments are rejected.

`FRONT_SOCIAL_CONTEXT_ENABLED` remains opt-in while browser-specific reply/comment extraction is being live-validated.

### Contradiction handling
Origin-platform, origin-year, and claimed-original-account statements are stored as `CLAIMED`. Conflicting claims are surfaced as `CONFLICTING`; Front does not silently pick a winner.

## Canonical dashboard gate remains unchanged

These changes do **not** weaken the existing canonical promotion gate. `WATCH / EARLY / RISING` remain scan-level intelligence. Only the existing semantic/corroboration rules may create a dashboard-qualified narrative.

## Release gates

Before advancing to main:
1. Full browser-bridge unit suite green.
2. TypeScript, lint, production build green.
3. Existing collector/acquisition regressions remain green.
4. Authenticated local scan on the tested commit.
5. X + TikTok acquisition remains broad.
6. Post-understanding completes without systemic timeout regression.
7. Ledger writes understanding frames and narrative memory.
8. `WATCH / EARLY / RISING` cannot self-promote.
9. Same-handle cross-platform evidence cannot fake independent creators.
10. Comment-only support cannot create `EARLY` or `RISING`.
11. Stale memory cannot appear in unrelated scans.
12. Golden/main branch remains unchanged until explicit release approval.
