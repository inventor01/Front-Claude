# Front Browser Bridge

This optional local companion makes X and TikTok usable without requiring their APIs for normal discovery.

## What it does

- Opens a persistent local Chromium profile stored at `~/.front-browser-bridge/profile`.
- Uses that browser session to read X Explore/Latest search results and TikTok search/Creative Center pages.
- Sends only extracted evidence records to the Front web app when you run a scan from the Browser Sources panel.
- Never uploads X/TikTok cookies or passwords.
- Does not bypass CAPTCHAs, login challenges, rate limits, or platform blocks.

## Start on macOS

From the repository folder:

```bash
chmod +x browser-bridge/start.command
./browser-bridge/start.command
```

The first run installs the bridge package and Playwright Chromium. After it starts, open Front, choose **Browser Sources**, click **Open X + TikTok login**, sign in once in the local browser windows, then click **Run browser scan**.

## Cost model

Normal browser collection has no X/TikTok API fee. Front's existing X API connection remains available as an optional structured-data fallback. Browser extraction can break when either site changes its UI; Front reports source warnings instead of pretending a scan succeeded.

## Security

The bridge listens only on `127.0.0.1:43981`. Cross-origin access is restricted to the current Railway Front domain, the known ChatGPT Site domain, and local development by default. Override with `FRONT_ALLOWED_ORIGINS` if the deployment domain changes.
