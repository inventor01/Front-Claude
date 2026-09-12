# Front v13 — Live-feed quality repair

## Root causes found in production

1. The topic detector still allowed ordinary one-word language fragments and translated social-audio boilerplate to become candidate narratives. Live examples included `created`, `ever`, `solo`, `sonido`, `sonido original`, and `оригинальный звук`.
2. A narrative received an X + TikTok boost whenever linked evidence existed on both platforms, even when those posts were connected only by a generic word rather than the same event.
3. Pump.fun launch matching used normalized lexical equality/containment, so a generic narrative such as `created` could match a coin such as `Create coin`.
4. Single-name fragments and their full entity could remain as separate narratives when they shared the same evidence (for example `Madison`, `Cassaday`, and `Madison Cassaday`).
5. When view counts were unavailable from a page snapshot, the priority feed had no engagement fallback and could show `0 views/hr` even when likes were moving quickly.

## Permanent fixes

- Add a shared server-side narrative quality policy with multilingual social/UI boilerplate filtering and a distinctiveness gate. The server rejects junk even if an older local bridge submits it.
- Make one-word automatic narratives exceptional: they must be distinctive and repeated by at least three independent creators.
- Suppress single-word fragments when the same evidence supports a fuller multi-word entity/event.
- Calculate semantic X↔TikTok corroboration from the actual supporting post text; raw platform presence no longer earns a cross-platform priority bonus.
- Require at least one strong main-feed signal: same-event cross-platform corroboration, fast engagement, repeated/cross-posted media, an accelerating/spreading lifecycle, or a context-valid Pump.fun creation match.
- Add likes/hour as a fallback acceleration signal when a source page does not expose views, while continuing to prioritize real views/hour when available.
- Restrict Pump.fun Exact/Strong matches to distinctive validated narrative aliases. Single first/last-name fragments of a multi-word event are not eligible for Exact matches.
- Downgrade a coin to Possible when it predates Front's current narrative evidence by more than 72 hours.
- Treat missing market-cap/liquidity/volume values as unknown rather than `$0`.
- Add regression tests for multilingual `original sound` boilerplate, ordinary-word leakage, full-name fragment suppression, and true cross-platform event corroboration.

## Release gate

Do not merge until the full GitHub CI passes browser bridge tests, migration/schema verification, local D1 persistence, typecheck, lint, and production build.
