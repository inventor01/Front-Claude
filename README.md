# Front — Narrative Desk

Private web companion to [the Front scanner](https://github.com/inventor01/front43_updated_keywordlogic_complete_89keywords/pull/1), implementing the narratives-first workflow in Front II.

## Use the desk

1. Open Discover. Public Google Trends US topics and DEX Screener market themes load automatically. Automatic matching searches the first three signals from each feed; choose any signal to run a manual search.
2. Search a narrative, ticker or exact Solana mint. Results combine up to two DEX Screener query variants, up to three GeckoTerminal pages, and exact-mint lookup where applicable. Mints deduplicate, with the most liquid pool supplying the displayed quote. Coverage and failures remain visible.
3. Bookmark a coin to save it privately. Research the mint again for fresh data.
4. Choose Paper buy, enter simulated dollars, then close the position from Paper portfolio. Server quotes determine both fills. Entries require at least $1,000 liquidity and are capped at $10,000 or 1% of pool liquidity. Both sides assume 1% adverse slippage plus 0.3% fees. No wallet, real order or funded balance exists.
5. In Sources, connect an X bearer token and 1–150 aggregator handles. Run a manual scan or explicitly enable scans every 15 minutes. Provider charges/access limits apply. Up to 100 recent posts per handle batch are sampled; shared URLs and hashtags across two or more distinct authors form evidence groups. This is a transparent cross-account heuristic, not embeddings or a complete virality model.
6. Optionally enable Launch stream for PumpPortal creation events. Reconnect uses capped exponential delay. Events remain in this browser session, latest 80 only.

## Honest boundaries

- Browser-driven discovery refreshes every five minutes while visible. X scanning is opt-in and browser-driven. Neither is a 24/7 scheduled job. The separately implemented Python scanner requires its own production runtime and credentials for background alerts.
- Provider responses are validated at the boundary (`lib/schemas.ts`). Validation is lenient by design: unreadable entries are dropped and unknown fields pass through, so a provider changing its payload degrades coverage instead of breaking the desk. A response that is not recognisably the right shape is reported as a source failure, not as zero results.
- Search is bounded by provider indexes and pagination caps; zero results never prove no related coin exists. Matching names/hashtags/links is not proof of token association, ownership, originality or future returns.
- TikTok metrics, the historical five-factor virality score, holder concentration, mint authority and sellability checks are not implemented here. Missing data is explicitly unknown. No fabricated data or safety score.
- Paper results do not model network fees, failed sells, MEV, price impact beyond fixed slippage or actual token sellability. Unclosed positions have no unrealized P&L estimate. The UI shows the most recent 500 positions.
- X credentials and the historical 150-handle list were not available during implementation, so live X account access remains unverified. Configure them in the application, not in source or chat.

## Persistence and security

Cloudflare D1 stores owner-scoped watchlists, paper positions and encrypted X settings. Production identity comes only from Sites ChatGPT authentication. Every API checks identity; every mutation checks same-origin requests. Paper entry IDs deduplicate retries per owner (`trades` is keyed on `(owner, id)`, so one owner's client-supplied ID cannot suppress another's); closes are conditional on an open position. Provider requests have 12-second timeouts. Public data is cached for 1–5 minutes; X results for 15 minutes per owner. The `FRONT_SETTINGS_KEY` secret (32 random bytes, base64) is managed as a Sites runtime secret and encrypts X tokens using AES-GCM. It must be preserved to decrypt stored settings. Disconnect deletes the credential and cached X results.

Schema: `db/schema.ts`; generated migrations: `drizzle/`. Runtime uses prepared D1 statements. No runtime schema creation.

## Hosting configuration

`.openai/hosting.json` declares which Cloudflare bindings this Site needs. It is read at
config time by `vite.config.ts` and copied into `dist/.openai/` at build time, so it must
stay committed:

```json
{ "d1": "DB", "r2": null }
```

`d1` is the D1 binding name the application reads (`env.DB`). `r2` is `null` because no
object storage is used; set it to `"BUCKET"` to provision the bucket declared in
`cloudflare-env.d.ts`. Database IDs are placeholders locally and injected by the control
plane on deploy. This file holds binding names only — never secrets. `FRONT_SETTINGS_KEY`
remains a Sites runtime secret.

## Verify and build

- `npm run install:ci` installs from the lockfile.
- `node tests/verify.mjs` exercises deduplication, partial provider failures, costs/invalid prices, query batching, real SQLite migrations, authentication, CSRF, owner isolation, order idempotency, encryption and disconnect using synthetic provider responses.
- `node node_modules/typescript/bin/tsc --noEmit`
- `npm run lint`
- `npm run build` produces `dist/`, including `dist/.openai/hosting.json` and the generated migrations.
- Build/deploy through the Sites plugin helper scripts. Source lives in the Site's connected repository.

`.github/workflows/ci.yml` runs all of the above on every push and pull request, and additionally fails if `db/schema.ts` was changed without a generated migration.

No real trades are executed. The product is a research and paper-trading tool, not a promise of income.
