# Front bug / change log

## 2026-09-11 — X/TikTok trends were invisible or mixed into Narrative Radar

**Root cause:** Front stored browser-derived X/TikTok evidence and separately fetched Google Trends/DEX market themes, but the Discover endpoint mixed those sources together with corroborated narratives. Raw browser trends were therefore not presented as a first-class feed, broad topics competed with niche narratives for the same visible slots, and the user could not clearly distinguish “Front noticed this” from “Front promoted this as a corroborated narrative.”

**Permanent fix:** Added a dedicated Public Signals feed and API. X Trending, X Feed, X Search, TikTok Trending, TikTok Explore, TikTok Search, Google Trends and market themes now appear as raw discovery signals with source, age, metrics when available, and promotion status. Narrative Radar is now reserved for corroborated/stored narratives and no longer mixes in public-provider rows. Public Signals has source filters, search and 50-per-page pagination. Radar Manager keeps full radar pagination, lifecycle, cleanup, dedupe, merge/delete controls, and now displays stored coin candidates with direct Pump.fun/Axiom links.

**Regression protection:** Full CI covers core app tests, browser bridge tests, migrations, local D1 migration, typecheck, lint and production build. Raw broad observations can remain visible in Public Signals without bypassing the stricter narrative-promotion gate.

## 2026-09-11 — TikTok timed out and browser narratives did not surface in Narrative Radar

**Root cause:** The browser bridge waited for full `domcontentloaded` on TikTok Creative Center, which can stall for analytics/region resources and exhaust the 45-second navigation timeout even when useful page content is already available. X Explore could also return zero without raising a warning. Separately, saved browser evidence created stored narratives, but Discover still rendered only the separate public-signal feed, so successful browser discoveries were not guaranteed to appear in the main Narrative Radar.

**Permanent fix:** Browser navigation now waits only for the initial document commit, then gives DOM readiness a bounded best-effort wait. TikTok Creative Center extraction now falls back to page hashtags and then to TikTok Explore video data if Creative Center is unavailable. X Explore uses broader trend selectors plus hashtag fallback and reports a clear warning if nothing can be extracted. Saved browser evidence automatically promotes fresh narratives, attempts bounded coin matching for the freshest narratives, and Discover now merges stored browser narratives ahead of public signals. A successful browser scan reloads the desk so the Narrative Radar immediately reflects the newly stored evidence.

**Regression protection:** Added deterministic tests for hashtag fallback and X trend-label extraction. Existing bridge launch, health, origin, unit, typecheck, lint, build, migration, and bundle checks remain in CI.

## 2026-09-11 — Scan could not attach to Front Chrome (`ECONNREFUSED 127.0.0.1:43982`)

**Root cause:** An older dedicated Front Chrome process could remain alive from a previous login launch that did not include the remote-debugging flags. When Front later launched Chrome with `--remote-debugging-port=43982`, Chrome reused the already-running process for that profile and silently ignored the new startup flags. The tabs opened, but no DevTools endpoint listened on 127.0.0.1:43982, so every scan failed before collection with `ECONNREFUSED`.

**Permanent fix:** Before opening the Front login browser, the bridge now terminates only Chrome processes using Front's private `~/.front-browser-bridge/chrome-profile`, waits for the profile to release, launches a fresh Chrome process with the loopback DevTools endpoint, and actively polls `/json/version` until Chrome returns a WebSocket debugger URL. `/open-login` now returns success only after the scan connection is actually ready. Chrome is also launched with background mode disabled and a new window to reduce stale-profile reuse.

**Regression protection:** Added tests for targeted Front-profile termination, DevTools readiness polling/retry, loopback-only debugging arguments, and the dedicated login profile. Bridge status is version 4 and exposes the CDP URL for diagnostics.

## 2026-09-11 — Scans returned zero because login Chrome locked the authenticated profile

**Root cause:** Front first opened a dedicated regular Chrome profile for X/TikTok login, then tried to launch a second Playwright-controlled Chrome process against that exact same profile for scanning. Chrome correctly locked the profile while the login browser was alive, so both X and TikTok collectors failed before navigation with the same profile-in-use error. Closing the login browser avoided the lock but also made the UX brittle and contradicted the goal of using the exact trusted logged-in browser session.

**Permanent fix:** The login Chrome now exposes a loopback-only Chrome DevTools Protocol endpoint on `127.0.0.1:43982`. The scanner attaches to that already-running, already-authenticated Chrome session with Playwright `connectOverCDP` instead of launching a second browser against the profile. The user can keep the dedicated Front Chrome window open (or minimized) while scans run; there is no second process competing for the profile lock.

**Security:** The DevTools endpoint binds to loopback only. Front still never uploads cookies or passwords, and it does not bypass CAPTCHAs, login challenges, platform blocks, or account restrictions.

**Regression protection:** Added launcher tests that require the loopback remote-debugging address/port and verify the dedicated Front profile and X/TikTok login URLs.

## 2026-09-11 — Browser evidence save failed with “Invalid request origin” on Railway

**Root cause:** The browser correctly sent Front's public HTTPS `Origin`, but the server-side request URL can reflect Railway's internal proxied HTTP host. The evidence endpoint compared those two raw origins directly, so a legitimate same-site request was rejected after a successful local X/TikTok scan.

**Permanent fix:** Added proxy-aware same-origin validation. Front still accepts direct same-origin requests, but when running behind a reverse proxy it reconstructs the public origin from `x-forwarded-host` / `x-forwarded-proto` (falling back to `Host`) before comparing it to the browser `Origin`. Cross-site origins remain rejected.

**Regression protection:** Added tests for direct same-origin, Railway-style forwarded HTTPS origin, forged cross-site origin, and missing-Origin rejection.

## 2026-09-11 — X/TikTok rejected sign-in inside Playwright Chromium

**Root cause:** Front opened the sign-in pages inside Playwright's bundled Chromium. Both X and TikTok can treat an automation-controlled Chromium session as higher-risk and refuse or temporarily limit authentication even when the credentials are correct. Repeated retries can make the platform-side restriction worse.

**Permanent fix:** The bridge now opens sign-in pages in the user's installed regular Google Chrome process with a dedicated Front-only local profile (`~/.front-browser-bridge/chrome-profile`). Front reuses that same profile for authenticated scans. Cookies still remain local and are never sent to Front's server.

**Safety:** Front does not bypass login challenges, CAPTCHA, platform anti-abuse systems, or temporary account restrictions. If a platform itself has temporarily limited an account, the user must wait for or complete the platform's normal recovery flow.

**Regression protection:** Added unit coverage for the system-Chrome launcher and dedicated profile arguments. Existing browser-launch, bridge-health, app tests, typecheck, lint, and build checks remain in CI.

## 2026-09-11 — Browser login returned HTTP 500 on Macs with an existing Playwright cache

**Root cause:** `browser-bridge/start.command` treated the presence of `~/Library/Caches/ms-playwright` as proof that Front's required Chromium revision was installed. Another project (including Python Playwright) can create that shared cache while using a different browser revision. Front therefore skipped `npx playwright install chromium`, the bridge itself started normally, but the first browser launch from `/open-login` failed with HTTP 500 because the exact Chromium executable required by Front's Node Playwright package was absent.

**Permanent fix:** Startup now asks Front's installed Playwright package for `chromium.executablePath()` and verifies that exact executable is runnable. If it is missing, startup installs the required Chromium revision and checks again before starting the bridge. If installation still does not produce a runnable executable, startup exits with the exact expected path and repair command instead of allowing a latent `/open-login` failure.

**Regression protection:** The readiness check is tied to Playwright's expected executable rather than a shared cache-directory heuristic, so unrelated Playwright installations can no longer create a false-positive browser-ready state.

## 2026-09-11 — X API dependency blocked low-cost social discovery

**Root cause:** Front's X scanning and narrative-origin research were coupled to a paid X bearer-token workflow. TikTok had only a manual URL inbox, so normal social discovery could not run without paid/limited API access.

**Permanent fix:** Added an optional local Playwright browser bridge for X Explore/Latest search and TikTok search/Creative Center, plus authenticated server-side evidence ingestion. The X API remains available as an optional structured-data fallback instead of being the only social source.

**Security:** Browser sessions stay in a local persistent profile under `~/.front-browser-bridge/profile`. The bridge binds only to `127.0.0.1`, restricts browser origins, and never uploads cookies or passwords. Evidence ingestion validates platform, URL host, content length, metrics, batch size, and same-origin requests.

**QA:** Added bridge helper unit tests, bridge health smoke test, normal app tests, D1 migration validation, typecheck, lint, production build, and deploy-bundle checks to CI.

**Known operational limit:** Browser selectors can change when X or TikTok change their websites. The collector reports source warnings rather than fabricating success. It does not bypass CAPTCHAs, login challenges, or rate limits.
