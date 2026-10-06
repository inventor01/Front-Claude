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
- Added UI research controls and evidence links.
- Added regression coverage for the awareness, scheduler, bridge sync, and no-BUY research boundary.

### Release gate
Merge and production deployment are blocked until CI passes. Live TikTok comment extraction and 24/7 bridge operation still require a connected local Front browser bridge and must not be represented as verified until observed live.
