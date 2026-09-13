# Front v26 runtime defaults + PumpPortal listener fix

Date: 2026-09-13
Branch: `v26-narrative-intelligence`
Golden remains immutable at `5701717964eab8caef3d3c86c12be358c2d7b55a`.

## Root causes

### “TikTok caps at 2 videos”
TikTok discovery was not capped at two posts. Live v26 had already collected 29 grounded TikTok posts. The small numbers were model-enrichment budgets: visual understanding intentionally selects only the highest-value videos for expensive Qwen processing. The old repo/local defaults were also still tuned for `qwen3-vl:8b`, which timed out on the verified 8 GB Mac.

### Settings advertised trend surfaces v26 did not consume
The Settings UI defaulted X Explore/Home and TikTok Trends/Explore switches on, but the v26 single-process runtime only reads `scanXForYou` and `scanTikTokForYou` for primary discovery. This made Settings imply coverage that was not active. v26 still derives and promotes semantic narratives from collected evidence, with independent-creator and semantic-corroboration gates; zero promoted narratives is valid when those gates are not met.

### PumpPortal listener stopped after leaving Settings
Settings owned its own `WebSocket`. React cleanup closed that socket whenever the Settings page unmounted. This was a lifecycle bug, not a PumpPortal stream failure.

### No migration/graduation lifecycle listening
The browser listener subscribed only to `subscribeNewToken`. PumpPortal also exposes `subscribeMigration`; creation and migration must remain distinct events because a graduation is not a new token creation.

## Permanent fixes

- Default local model is now `qwen3-vl:4b-instruct`, which completed the real Front one-video pipeline on the verified host after the 8B model timed out.
- Visual budgets are now deep=4, scout=2, background=1. These are analysis budgets only and do not limit X/TikTok feed acquisition.
- Bridge startup now loads repo defaults before private overrides and uses 4B / 4 / 2 / 1 hard fallbacks. A stale file-based `qwen3-vl:8b` default is migrated to 4B unless 8B was explicitly exported by the operator.
- Legacy Explore/Home/Trends switches are disabled and removed from the active v26 Settings controls instead of pretending they affect v26 discovery.
- Settings explicitly explains that promoted narratives require semantic + independent-creator corroboration.
- The PumpPortal browser listener is mounted once in the root layout and is controlled from Settings through shared local state/events. Leaving Settings no longer owns or destroys the socket.
- The single browser socket subscribes to both `subscribeNewToken` and `subscribeMigration`.
- Migration alerts are surfaced only for mints Front already matched/watched, and are stored/rendered as `migrate`, never as `create`.
- Creation matching and direct Pump.fun/Axiom/DexScreener links remain intact.

## Regression coverage

`tests/v26-runtime-settings-listener.test.mjs` verifies:

- tuned 4B and visual-budget defaults;
- Settings contains no page-owned PumpPortal `WebSocket`;
- legacy no-op trend controls are disabled;
- the root layout mounts the lifecycle watcher;
- the watcher subscribes to new-token and migration streams on the same socket;
- creation and migration event handling remain distinct;
- unrelated migrations are ignored unless the mint was already tracked by Front.

## Release status

Static CI/build/test validation is required after these commits. Authenticated live validation must still be run on the user’s Mac because GitHub CI does not have the dedicated X/TikTok Chrome profile, local Ollama model, or CDP 43982 session. Do not merge to `main` until those live checks pass.
