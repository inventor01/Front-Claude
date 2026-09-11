# Front Browser Bridge

This optional local companion makes X and TikTok usable without requiring their APIs for normal discovery.

## What it does

- Opens X and TikTok sign-in pages in regular Google Chrome using a dedicated local Front profile stored at `~/.front-browser-bridge/chrome-profile`.
- After you finish signing in and fully quit that Front Chrome window, Front reuses the same local profile for X Explore/Latest search and TikTok search/Creative Center scans.
- Sends only extracted evidence records to the Front web app when you run a scan from the Browser Sources panel.
- Never uploads X/TikTok cookies or passwords.
- Does not bypass CAPTCHAs, login challenges, rate limits, account restrictions, or platform blocks.

## Start on macOS

From the repository folder:

```bash
chmod +x browser-bridge/start.command
./browser-bridge/start.command
```

After it starts, open Front, choose **Browser Sources**, click **Open X + TikTok login**, and sign in normally in the regular Google Chrome windows Front opens. Once both sessions are ready, fully quit that Front Chrome window so its profile is unlocked, return to Front, and click **Run browser scan**.

If X or TikTok has already temporarily limited login, do not repeatedly retry. Complete the platform's normal verification/recovery flow or wait for the restriction to clear, then use the same Front Chrome profile again.

## Cost model

Normal browser collection has no X/TikTok API fee. Front's existing X API connection remains available as an optional structured-data fallback. Browser extraction can break when either site changes its UI; Front reports source warnings instead of pretending a scan succeeded.

## Security

The bridge listens only on `127.0.0.1:43981`. Cross-origin access is restricted to the current Railway Front domain, the known ChatGPT Site domain, and local development by default. Override with `FRONT_ALLOWED_ORIGINS` if the deployment domain changes.
