# Front Browser Bridge

This optional local companion makes X and TikTok usable without requiring their APIs for normal discovery. v18 keeps the v17 video-content understanding layer and adds scan supervision, manual cancellation, duplicate-scan protection, and a visual recovery path for feeds where the normal text extractor returns no usable evidence.

## What it does

- Opens X and TikTok sign-in pages in regular Google Chrome using a dedicated local Front profile stored at `~/.front-browser-bridge/chrome-profile`.
- Reuses that authenticated local Chrome session for X/TikTok For You discovery, search, investigations, origin research, and trend/sentinel scans.
- Extracts actual post-level evidence such as caption/text, creator, URL, publish time when available, engagement metrics, sounds, quoted/related posts, and visual context.
- For high-value video posts, the v17 content layer seeks across the whole video timeline and captures ordered representative frames. Short clips receive dense sampling; longer clips receive evenly distributed coverage.
- When a multimodal provider is configured, the frame sequence is interpreted into a grounded event summary, visible entities/objects, actions, on-screen text, visual motifs, confidence, uncertainties, and meme potential.
- If the primary v16/v17 scan returns zero evidence, v18 performs a bounded recovery pass against the same authenticated Chrome session and can admit caption-light X/TikTok videos to local vision analysis before they are discarded.
- Visual-only recovery rows never leave the Mac empty: they are uploaded only after the local vision model grounds them into meaningful semantic content. Brand-new visual narratives still need at least two grounded posts from two independent creators.
- Re-runs the normal deterministic narrative detector over enriched evidence. A visual model cannot bypass Front's independent-creator, junk-topic, corroboration, or Pump.fun provenance gates.
- Caches successful video understanding for seven days so Front does not repeatedly analyze the same clip.
- Exposes **Stop scan** in Front Settings. v18 terminates the active scanner/vision worker and restarts the internal scanner without deleting the Chrome profile, logins, settings, reputation/history state, or Ollama configuration.
- Rejects a duplicate manual scan before it reaches the older scanner, preventing a harmless collision from being recorded as the active scan error.
- Sends only extracted evidence records to the Front web app when you run/sync a scan. X/TikTok cookies and passwords stay in the local browser profile.
- Does not bypass CAPTCHAs, login challenges, rate limits, account restrictions, or platform blocks.

## Start on macOS

From the repository folder:

```bash
chmod +x browser-bridge/start.command
./browser-bridge/start.command
```

After it starts, open Front → **Settings**, click **Open X + TikTok login**, and sign in normally in the regular Chrome window Front opens. Leave that Front Chrome session available while scanning. Front's scan tabs themselves run in the background.

If X or TikTok has temporarily limited login, do not repeatedly retry. Complete the platform's normal verification/recovery flow or wait for the restriction to clear, then use the same Front Chrome profile again.

## Stop an active scan

Use **Front → Settings → Stop scan**. The equivalent local endpoint is:

```bash
curl -X POST http://127.0.0.1:43981/stop
```

v18 supervises the v17/v16 scanner tree and its zero-result visual-recovery worker as separate local process groups. Stop Scan terminates whichever path is active and starts a fresh internal scanner. It does not reset local data or browser authentication.

## Enable semantic video understanding

Frame capture is built into the content layer, but semantic interpretation requires either an OpenAI API key or a user-installed local Ollama vision model. Provider credentials are intentionally local-only; the Front cloud Settings page never receives the key.

Run the setup helper:

```bash
bash browser-bridge/configure-content.command
```

Choose OpenAI or Ollama, then restart `browser-bridge/start.command`. The private config is written to:

```text
~/.front-browser-bridge/content.env
```

with file permissions restricted to your local user. You can also copy `browser-bridge/content.env.example` there manually.

By default, Front analyzes at most 4 selected videos during a deep scan and 2 during Scout/background passes. It prioritizes high-value/fast posts, investigation results, weak-caption videos, and multiple independent creators instead of sending every feed video to a model.

## Why it does not send every raw frame

A 30 fps, 20-second clip contains 600 frames, most of which are nearly identical to adjacent frames. Sending all 600 images would multiply latency and inference cost without meaningfully improving narrative recognition. The content layer still covers the **entire video timeline**: it uses dense sampling on short clips and evenly distributed chronological samples on longer videos, with timestamps preserved. Up to 12 representative frames are sent to the multimodal model per analysis while local capture can be denser.

## Zero-result diagnostics

The primary scanner remains the first path. If it returns no evidence, v18 records a `fallbackDiscovery` audit containing how many X posts and TikTok video links the recovery pass actually observed. If recovery also returns zero grounded rows, the scan message surfaces that fact instead of posting an empty batch to the cloud. In that case, verify that the dedicated Front Chrome window is still signed in and visibly loads real X/TikTok posts.

## Cost model

Normal browser collection has no X/TikTok API fee. Multimodal video understanding has whatever inference cost belongs to the model/provider you configure; a local Ollama model has no per-call API charge. The analysis cache and small per-scan video caps are specifically designed to prevent repeat spending.

Front's existing X API connection remains available as an optional structured-data fallback. Browser extraction can break when either site changes its UI; Front reports source warnings instead of pretending a scan succeeded.

## Security

The bridge listens only on `127.0.0.1:43981`. Cross-origin access is restricted to the current Railway Front domain, the known ChatGPT Site domain, and local development by default. Override with `FRONT_ALLOWED_ORIGINS` if the deployment domain changes.

The content model key is read only from local environment/config. It is not written into repository files, scan payloads, cloud settings, or normal logs.
