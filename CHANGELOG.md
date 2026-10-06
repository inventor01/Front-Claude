## 2026-10-06 — Rolling-deploy persistence idempotence (v37)

### Root cause
Railway rolling deployments briefly run the old and new Front containers against the same persistent volume. The startup prep script deleted and recreated the already-correct `v3/observability` symlink on every boot. During handoff, that unnecessary shared-path mutation could race with the old runtime and produce `EEXIST`, while `start-server.mjs` merely warned and continued.

### Permanent fixes
- Persistence prep now leaves an already-correct observability symlink untouched.
- Legacy directory/file state is still repaired when necessary.
- A concurrent repair that results in the same verified target is accepted safely.
- Genuine persistence-preparation failure is now fail-closed; Front refuses to start in an unverified persistent-state configuration.
- Added regression tests proving repeated starts reuse the same symlink inode and legacy directories are repaired.

### Production proof needed
Merge/deploy remain blocked until the full Front CI suite passes. After deployment, Railway startup logs must show the idempotent reuse path without the previous `EEXIST` warning.

## 2026-10-06 — Social Arb bridge readiness visibility (v36)

### Root cause
Front already tracked the local browser bridge and active scroll jobs in cloud storage, but that status was only exposed through service-authenticated infrastructure endpoints. The signed-in Social Arb UI therefore could not distinguish a research problem from a physically offline Mac bridge without inspecting Railway logs.

### Permanent fixes
- Added a signed-in, read-only Social Arb bridge-status endpoint with no bridge key or browser credentials in its response.
- Reports bridge online/offline from recent polling, Chrome/scanner readiness, last-seen time, and the active queue count.
- Added visible online/offline readiness messaging directly above Social Arb results.
- When offline, the UI points to the new macOS autostart installer instead of failing silently.

### Security boundary
The route exposes operational readiness only. It does not return FRONT_BRIDGE_API_KEY, cookies, passwords, Chrome profile contents, or provider secrets.

## 2026-10-06 — Front local bridge watchdog + macOS autostart (v35)

### Root cause
The Railway queue and scheduler can now recover stale jobs, but real social scans still depend on the authenticated local Front bridge. Two local failure modes could silently stop collection: the cloud polling child had no restart supervisor, and the whole bridge required a manually kept-open Terminal session after every login or crash.

### Permanent fixes
- Added a cloud-agent supervisor that restarts Railway polling after unexpected child-process exits.
- Updated `start.command` to launch the supervisor instead of an unsupervised cloud-agent child and to shut it down cleanly.
- Added a macOS LaunchAgent installer with `RunAtLoad` and `KeepAlive` so the bridge can start at user login and restart after parent-process failures.
- The LaunchAgent stores only local paths; API keys, browser cookies, and social credentials remain in the existing local Front data/profile.
- Added a safe uninstaller that removes only the LaunchAgent and preserves the dedicated Chrome profile, logins, settings, evidence history, and local model configuration.
- Added shell-syntax and regression coverage for watchdog restart behavior and secret isolation.

### Remaining physical constraint
A user LaunchAgent cannot collect while the Mac is powered off, asleep, or logged out. The authenticated dedicated Front Chrome session must also remain usable; Front does not bypass platform login or verification challenges.

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