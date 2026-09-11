# Front bug / change log

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