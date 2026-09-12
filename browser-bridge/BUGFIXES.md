# Browser Bridge Bug Fix Log

## 2026-09-12 — v19 Chrome CDP compatibility and scan ledger

### Dedicated Front Chrome connected, but every scan still returned zero

**Root cause:** the dedicated Chrome debug endpoint itself was reachable, but Playwright attempted its normal `Browser.setDownloadBehavior` setup while attaching to the already-owned default Chrome context. The current Chrome/Playwright combination rejected that setup with `Browser context management is not supported`, so X, TikTok, the v18 fallback collector, and the video-understanding layer all disconnected before any post could be inspected. This was why scans could report zero even while the login Chrome window was visibly open.

**Permanent fix:** v19 preloads a Playwright CDP compatibility shim into the entire local scanner process tree. All `connectOverCDP` calls now use Playwright's `noDefaults: true` compatibility mode, which skips unsupported default-context setup while retaining the already-authenticated default Chrome context. The shim is inherited by v18, v17, v16, and fallback workers, so the fix applies consistently instead of patching only one scan path.

### No proof of what a scan actually inspected

**Root cause:** prior versions exposed only final counts and error strings. A user could see `0 results` but could not distinguish no browser connection, zero DOM candidates, filtering, visual fallback, or model-grounding failure.

**Permanent fix:** v19 adds a local persistent scan ledger at `~/.front-browser-bridge/scan-ledger-v19.json`, a `GET /ledger` endpoint, live current-scan state, and a `/settings/ledger` UI. Every completed scan records start/end time, mode, observed and usable evidence counts, source/platform counts, fallback diagnostics, Ollama/video-understanding stats, errors, and up to 30 sample scanned post URLs. The ledger stays local and retains the most recent 100 scans. `POST /ledger/clear` clears historical entries without touching login state or scanner configuration.

### Regression protection

Coverage verifies the v19 launcher preloads the CDP compatibility layer, v19 is the default local bridge, ledger capabilities are reported, the ledger endpoint boots cleanly, and the existing v18 stop/fallback plus v17/v16 quality gates remain intact.

## 2026-09-12 — v18 zero-result recovery and scan cancellation

### Zero results despite active X/TikTok sessions

**Root cause:** v17 video understanding sat downstream of the v16 browser extractor. The v16 X path discarded posts that did not expose usable tweet text before checking whether the post contained video. The TikTok path likewise required usable caption/metadata text before creating evidence. As a result, caption-light or visual-only viral videos could be visible in the authenticated feeds yet never reach the Ollama vision layer. When the currently rendered feeds were dominated by those posts, the scan could return zero evidence and `contentUnderstanding.lastRun` would remain null.

**Permanent fix:** v18 keeps the proven v16/v17 scanner as the primary path, but when that path returns zero evidence it launches a bounded fallback discovery pass against the same authenticated Front Chrome session. The fallback identifies canonical X status URLs and TikTok video URLs even when caption text is missing. Visual-only rows stay local until the configured vision model grounds them into meaningful semantic content. Rows that are still empty after grounding are not uploaded. New visual-derived narratives still require at least two grounded evidence rows from two independent creators.

### No way to stop a long scan

**Root cause:** v16 used one in-process `running` flag and exposed no cancellation endpoint. Closing the Settings request did not terminate the browser scan or a later local vision pass.

**Permanent fix:** v18 is a supervisor process. The v17/v16 scanner tree and the zero-result vision recovery pass run as detached child process groups. `POST /stop` hard-stops whichever scan path is active, restarts the internal scanner cleanly, and preserves the dedicated Chrome profile, logins, local scanner configuration, Ollama configuration, history, reputation, and caches. Settings now exposes a **Stop scan** control.

### Duplicate scan requests poisoned status

**Root cause:** v16 correctly rejected a second concurrent `POST /scan`, but its outer request handler copied the collision exception into the shared `lastError`, making a healthy first scan look broken.

**Permanent fix:** v18 checks current scanner health before forwarding a manual scan. If one is already active it returns `409` with an instruction to use Stop scan, so the duplicate never reaches v16 and cannot overwrite shared scan status.

### Stale startup error remained visible after recovery

**Root cause:** v17 could retain `Scanner child unavailable: fetch failed` from the brief child-startup window even after later requests proved the child was healthy.

**Permanent fix:** v18 reports its own supervisor health, clears the obsolete startup-only message when the inner gateway is responding, and retains current errors that still need attention.

### Regression protection

Coverage now checks that v18 is the default bridge, visual-only candidates can reach local grounding, fallback-derived topics retain the two-creator safety gate, duplicate scans are blocked before v16, and the supervisor can hard-stop/restart the internal scanner tree.
