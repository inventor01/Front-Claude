# Browser Bridge Bug Fix Log

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
