# Browser Bridge v20.1 Bug Fix Log

## 2026-09-12 — Five-minute deep-scan proxy failure

### Symptom
A deep scan attached to Chrome and the v20 live observer could see real X/TikTok posts, but the canonical scan consistently failed after about 301 seconds. The v19 ledger then recorded `A scan is already running. Use Stop scan before starting another one.` even though the user had clicked Run Deep Scan only once.

### Root cause
The scanner is intentionally layered (v20 → v19 → v18 → v17 → v16). Each layer forwarded `POST /scan` with Node's built-in `fetch()` and waited for the downstream layer to finish the entire scan before returning response headers. Node/Undici applies a roughly five-minute response-header timeout by default. When a legitimate deep scan ran longer than that, an outer internal fetch timed out while the inner v16 scan kept running. v19 was configured to retry a failed downstream request once, so the retry sent a second state-changing `POST /scan`. v18 correctly saw the still-running original scan and returned the duplicate-scan 409. The ledger therefore showed a misleading duplicate error at almost exactly five minutes.

### Permanent fix
`loopback-scan-fetch-compat.mjs` is preloaded into the complete local scanner process tree. It intercepts only loopback `POST /scan` requests and forwards them with Node's native `http.request`, which does not inherit the five-minute fetch headers timeout. The transport uses a bounded 15-minute safety timeout and converts local transport failures into HTTP error responses instead of rejected promises, so outer retry loops cannot accidentally re-issue a state-changing scan request. Normal health/config/login requests continue to use regular `fetch()`.

## 2026-09-12 — Live TikTok preview captured notification/activity text

### Symptom
The v20 live observer proved that it could see TikTok pages, but several preview rows used a long numeric pseudo-author and repeated old text such as `started following you`, `liked your video`, and `Follow back` instead of the actual video caption. Some X preview URLs also ended in `/analytics`.

### Root cause
The first v20 live observer intentionally used broad DOM fallbacks so it could display findings immediately during a scan. On TikTok, a generic parent-element fallback could bind a `/video/` link to notification/sidebar containers. On X, status links were not canonicalized before preview sync.

### Permanent fix
`live-preview-compat.mjs` sanitizes the v20 snapshot before the dashboard or cloud sync sees it. It canonicalizes X and TikTok post URLs, rejects long numeric TikTok pseudo-authors, rejects repeated notification/activity language, recomputes live platform counts from sanitized evidence, and withholds live candidate topics unless at least two sanitized evidence rows from two independent creators support them. Failed live scans now also carry a diagnostic directing the user to `/ledger` when the outer status is failed but the preview layer itself has no error text.

## Regression protection
- `loopback-scan-fetch-compat.test.mjs` verifies that loopback `POST /scan` uses the native long-scan transport and that transport failures resolve to HTTP errors instead of rejecting into a retry loop.
- `live-preview-compat.test.mjs` verifies URL canonicalization, TikTok activity-text rejection, legitimate post preservation, sanitized live counts, and two-creator topic gating.
- Existing v16/v17/v18/v19/v20 browser bridge regression suites remain in place.
