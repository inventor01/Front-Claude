## 2026-10-06 — Social Arb stale queue recovery (v34)

### Root cause
The 24/7 Social Arb scheduler correctly applied backpressure whenever any scroll job was active, but queued jobs had no age limit. Lease reclamation only happens while a local bridge is polling, so one abandoned queued or leased job could block autonomous scanning indefinitely when the bridge was offline.

### Permanent fixes
- Added authenticated queue maintenance before every Social Arb autoscan backpressure check.
- Social Arb queued jobs expire after 30 minutes and stale leased Social Arb jobs after 45 minutes.
- AI Employee OS/external jobs receive much longer 6-hour queued and 8-hour stale-active TTLs so Social Arb cannot aggressively cancel downstream work.
- Only non-terminal queue states are eligible for expiry; completed/failed/cancelled history is preserved.
- Stale bridge-agent presence is marked OFFLINE after 90 seconds without polling.
- Active-job diagnostics now expose caller, lease expiry, and queue age.

### Release gate
Merge and Railway deployment are blocked until the full Front CI suite passes. A connected local authenticated browser bridge is still required to execute social scans; queue recovery prevents deadlock but does not fabricate browser availability.

## 2026-10-06 — Social Arb point-in-time performance journal (v33)

### Root cause
Front could now detect a social information gap, but it still could not prove whether a candidate actually preceded market movement. Without an immutable price baseline and later outcome measurements, successful-looking alerts could only be judged with hindsight.

### Permanent fixes
- Added a Tiingo-backed market-data adapter using documented token-header authentication, derived reference prices, and historical EOD bars.
- Freezes the research-time reference price when Tiingo is connected; if the provider was unavailable at that moment, Front preserves the timestamp and can only backfill the prior completed session close, explicitly labeled as a backfill.
- Added a persistent outcome journal with 1, 5, 20, and 60-session measurements.
- Added a bounded daily outcome evaluator to the existing 24/7 Social Arb scheduler.
- Added UI visibility for baseline method, pending/measured horizons, and provider readiness.
- Price tracking remains research evidence only and does not emit BUY/SELL instructions.
- Tiingo remains feature-gated behind `TIINGO_API_KEY`; Front does not silently substitute undocumented or ambiguously licensed feeds.

### QA gate
Merge and production deployment remain blocked until the full Front CI suite passes.

# Front changelog

## 2026-10-06 — Social Arb alpha validation pipeline (v32)

### Root cause
Front could detect social and consumer change and map a public-company ticker, but it stopped before testing market awareness, remote 24/7 scans did not automatically persist their Social Arb signals into cloud history, and there was no point-in-time research journal. That made the system useful for discovery but not yet falsifiable as an investment-research process.

### Permanent fixes
- Added an immutable point-in-time Social Arb research journal.
- Added downstream SEC filing and financial-media awareness checks for ticker-verified candidates.
- Added conservative information-gap states including company unresolved, weak social evidence, insufficient awareness data, early/high candidate, gap narrowing, and parity likely.
- Added materiality/exposure states that explicitly refuse to infer product-level financial importance from virality alone.
- Added bridge-authenticated persistence so remote browser scans save Social Arb results to Railway history without requiring interactive browser-session auth.
- Added a backpressured 15-minute autoscan scheduler with rotating consumer categories and periodic deep scans.
- Automatically runs bounded awareness research for the strongest ticker-verified RISING/HIGH_SIGNAL candidates after bridge sync, while preserving a manual re-check control in the UI.
- Added UI research controls and evidence links.
- Added regression coverage for the awareness, scheduler, bridge sync, and no-BUY research boundary.

### Release gate
Merge and production deployment are blocked until CI passes. Live TikTok comment extraction and 24/7 bridge operation still require a connected local Front browser bridge and must not be represented as verified until observed live.