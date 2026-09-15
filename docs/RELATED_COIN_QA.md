# Related coin intelligence — 2026-09-13

## Result

Added cached direct Pump.fun pool discovery, retained creation-event inventory, semantic-first ranking, immutable MC baselines, atomic snapshot history, momentum scoring and shared related-coin cards. Background refresh rotates through narratives and does not gate scan completion. Existing matches are revalidated, removing false associations from current cards while retaining history.

## Root causes

1. Symmetric phrase containment accepted a short coin name inside a longer narrative alias. The corrected rule requires the full validated phrase in the token name; multiple-word overlap requires multiple distinctive shared terms. Generic singleton aliases cannot qualify.
2. Refresh overwrote previous market data without a match baseline or history. Missing numeric fields could become zero and FDV could masquerade as market cap. Unknown values now remain null, immutable baselines persist, and current records plus history are written atomically.
3. The watcher discarded unmatched creations, preventing later reverse discovery. It now retains creation events for subsequent matching; direct Pump.fun pool discovery provides separately labeled historical candidates.
4. Local scanner source contained invalid escaped template delimiters. Syntax validation now covers startup parsing. Remote TikTok filters and current scan UI changes were integrated, preserving both branch histories.

## Validation

- Node suites: **168 passed, 0 failed, 0 skipped** (application and scanner suites combined).
- Existing SQL/auth/provider integration harness: **passed**.
- Additional SQL pipeline assertions: **8 passed**, covering no match, multiple matches, generic rejection, snapshots, SOL units, caching, revalidation and retained history.
- Authenticated creation-route assertions: **4 passed**, covering trade rejection, creation acceptance, reverse matching and persisted association.
- SQLite close/reopen regression is included in the Node suite.
- Production build: **passed**.
- TypeScript: **passed**, no errors.
- ESLint: **0 errors, 28 warnings**.
- Shared card rendered at 1200px and 390px widths without horizontal overflow. Visual fixture is explicitly synthetic.
- Golden checkpoint resolves to `5701717964eab8caef3d3c86c12be358c2d7b55a`.
- Port 43982 was not altered or connected to. Headless visual QA used its own temporary browser.
- Front's local Qwen/Ollama configuration was not changed.

## Real deployed-data check

The existing deployment returned `Tesla Roadster Unveil Launch → CLAUDE ($CLD)` as a strong match. This is a **rejected association**, not a successful narrative call. Its deployed cached MC was **$2,843.24**; MC at Front match and verified launch lead time were unavailable. The `Coding Agent → Agent (Visper)` partial-name association is also rejected by the corrected matcher. Both patterns have regression coverage.

Actual CLAUDE mint from the deployed record: `E5mBtVvukFm9bVGSPwhwGSP4QNdVm1RdmHAXVV75pump`.

- [Pump.fun](https://pump.fun/coin/E5mBtVvukFm9bVGSPwhwGSP4QNdVm1RdmHAXVV75pump)
- [Axiom](https://axiom.trade/t/E5mBtVvukFm9bVGSPwhwGSP4QNdVm1RdmHAXVV75pump)
- [DexScreener](https://dexscreener.com/solana/E5mBtVvukFm9bVGSPwhwGSP4QNdVm1RdmHAXVV75pump)

The local application database was empty. No genuine positive live match or historical gain is claimed. The **synthetic** Daejon Love fixture verifies $8,200 → $94,000, +$85,800 (+1,046.34%), with a separate known-timestamp lead-time fixture.

## Coverage and limitations

- Discovery covers retained PumpPortal creation events and search results with a direct Pump.fun pool. It is not an exhaustive Solana index and cannot recover every coin launched while Front was offline, particularly graduated-only listings.
- Matching uses validated narrative titles/aliases and token name/symbol. It does not independently inspect coin images, metadata descriptions, or social links with Qwen in this iteration.
- Exact creation time remains unknown when providers supply only event observation or pair creation time. Those values are kept distinct; verified lead time remains unavailable rather than inferred.
- PumpPortal's SOL market cap remains explicitly denominated in SOL. No unverified conversion to a USD launch baseline is performed.
- Missing USD data at match stays missing forever for that baseline; the first later quote is labeled first observed MC. Legacy records do not acquire an invented historical match quote.
- Holder quality/count and bonding progress remain unavailable unless reliable data exists. Momentum is heuristic; missing transaction data yields UNKNOWN.
- The creation alert uses validated matching but does not yet display every persisted market metric in the notification itself; full metrics live in the related-coin details.
- Database migration `0009_coin_observations.sql` is applied by the existing startup migration mechanism.
- Production rollout and a genuine positive live-match smoke test remain outstanding. **PR #61 should not yet be treated as fully production-validated or merged on that basis.**
