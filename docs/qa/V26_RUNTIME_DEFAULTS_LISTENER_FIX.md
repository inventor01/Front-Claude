# Front v26 runtime defaults + PumpPortal listener fix

Date: 2026-09-13
Branch: `v26-narrative-intelligence`
Golden remains immutable at `5701717964eab8caef3d3c86c12be358c2d7b55a`.

## Root causes

### “TikTok caps at 2 videos”
TikTok discovery was not capped at two posts. Live v26 had already collected 29 grounded TikTok posts, and the authenticated release-gate rerun later climbed from 2 to 12 grounded TikTok posts during discovery. The small numbers were model-enrichment budgets: visual understanding intentionally selects only the highest-value videos for expensive Qwen processing. The old repo/local defaults were also still tuned for `qwen3-vl:8b`, which timed out on the verified 8 GB Mac.

### Live startup still reported 8 deep / 4 scout after repo defaults changed
Authenticated QA on commit `9a404d5` exposed a startup-precedence bug. `start.command` correctly loaded the repo `content.env`, but then loaded `~/.front-browser-bridge/content.env` afterward. That private file still contained the legacy 8B-era `8/4/2` visual budgets, so the live bridge health endpoint reported deep=8 and scout=4 even though the repo defaults were 4/2/1. This was why the fresh release-gate scan collected evidence successfully and then spent an excessive amount of time in `visual-understanding`.

### Post understanding still selected 8B
The same private runtime config could retain `FRONT_CONTEXT_OLLAMA_MODEL=qwen3-vl:8b`. Post understanding therefore attempted to load a separate 8B model after vision used 4B. On the verified 8 GB host this defeats the warm-model optimization and reintroduces the model that already failed the one-video latency gate.

### Settings advertised trend surfaces v26 did not consume
The Settings UI defaulted X Explore/Home and TikTok Trends/Explore switches on, but the v26 single-process runtime only reads `scanXForYou` and `scanTikTokForYou` for primary discovery. This made Settings imply coverage that was not active. v26 still derives and promotes semantic narratives from collected evidence, with independent-creator and semantic-corroboration gates; zero promoted narratives is valid when those gates are not met.

### PumpPortal listener stopped after leaving Settings
Settings owned its own `WebSocket`. React cleanup closed that socket whenever the Settings page unmounted. This was a lifecycle bug, not a PumpPortal stream failure.

### No migration/graduation lifecycle listening
The browser listener subscribed only to `subscribeNewToken`. PumpPortal also exposes `subscribeMigration`; creation and migration must remain distinct events because a graduation is not a new token creation.

## Permanent fixes

- Default local model is now `qwen3-vl:4b-instruct`, which completed the real Front one-video pipeline on the verified host after the 8B model timed out.
- Visual budgets are now deep=4, scout=2, background=1. These are analysis budgets only and do not limit X/TikTok feed acquisition.
- Bridge startup loads repo defaults before private overrides and uses 4B / 4 / 2 / 1 hard fallbacks.
- Exact stale private defaults from the prior 8B profile are now compatibility-migrated at startup when there is no deliberate shell override: deep 8→4, scout 4→2, background 2→1, and local 8B vision→4B.
- Local post understanding now defaults to the same Ollama model/endpoint as visual understanding. An exact stale private `qwen3-vl:8b` context model is migrated to the current local model unless `FRONT_CONTEXT_OLLAMA_MODEL` was explicitly exported by the operator.
- Deliberate shell exports remain highest priority so stronger hardware can intentionally opt into larger models or different budgets.
- Legacy Explore/Home/Trends switches are disabled and removed from the active v26 Settings controls instead of pretending they affect v26 discovery.
- Settings explicitly explains that promoted narratives require semantic + independent-creator corroboration.
- The PumpPortal browser listener is mounted once in the root layout and is controlled from Settings through shared local state/events. Leaving Settings no longer owns or destroys the socket.
- The single browser socket subscribes to both `subscribeNewToken` and `subscribeMigration`.
- Migration alerts are surfaced only for mints Front already matched/watched, and are stored/rendered as `migrate`, never as `create`.
- Creation matching and direct Pump.fun/Axiom/DexScreener links remain intact.

## Live QA evidence

On the authenticated release-gate run from commit `9a404d5`:

- CDP 43982 stayed reachable and Playwright attached to the existing authenticated Chrome context.
- X authenticated successfully and TikTok was neither login-walled nor challenged.
- TikTok discovery increased through 2, 4, 6, 8, 9, 11 and 12 grounded observations, proving there is no two-video discovery cap.
- The run exposed the stale runtime profile before completion: health reported visual model 4B but context model 8B, with deep=8 and scout=4. The scan then remained in `visual-understanding` long enough to confirm those stale budgets materially affected runtime.
- CDP 43982 was not restarted or repurposed during QA.

## Regression coverage

`tests/v26-runtime-settings-listener.test.mjs` verifies:

- tuned 4B and visual-budget defaults;
- local context understanding uses the same 4B profile;
- startup contains compatibility migrations for the exact stale 8B-era model and 8/4/2 budgets;
- Settings contains no page-owned PumpPortal `WebSocket`;
- legacy no-op trend controls are disabled;
- the root layout mounts the lifecycle watcher;
- the watcher subscribes to new-token and migration streams on the same socket;
- creation and migration event handling remain distinct;
- unrelated migrations are ignored unless the mint was already tracked by Front.

## Release status

Static CI/build/test validation is required after these commits. Authenticated live validation must still be rerun on the user’s Mac because GitHub CI does not have the dedicated X/TikTok Chrome profile, local Ollama model, or CDP 43982 session. Do not merge to `main` until the corrected live profile reports 4B for both visual and post understanding, 4/2/1 analysis budgets are active, and the release gate completes cleanly.
