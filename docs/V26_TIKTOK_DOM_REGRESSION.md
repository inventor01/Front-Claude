# v26 TikTok For You DOM regression — 2026-09-13

## Root cause

The live v26 scanner successfully attached to the dedicated Front Chrome session and loaded `https://www.tiktok.com/foryou`, but TikTok discovery returned `observed: 0`, `grounded: 0`, and no browser errors.

A direct DOM probe proved the page was healthy and authenticated:

- 10 real `/@user/video/<id>` anchors were present.
- 9 `recommend-list-item-container` feed containers were present.
- No login wall was detected.
- No CAPTCHA/security challenge was detected.
- The old strict filter admitted 0 anchors.

The regression was caused by an over-broad activity exclusion selector in `tiktok-observer-v21.mjs`. Selectors such as `[data-e2e*="inbox"]` matched persistent TikTok navigation/inbox chrome that can sit above or around the For You feed. Valid recommendation cards were therefore rejected simply because a broad ancestor matched an activity-like selector.

This was a filtering regression, not a CDP, authentication, TikTok availability, or browser-session failure.

## Permanent fix

- Keep an allow-list for recognized feed/discovery containers: `recommend-list-item-container`, `recommend-item`, `feed-item`, `search-card`, and bounded `article` fallback.
- Replace broad activity ancestor matching with local activity-item selectors such as `inbox-list-item`, `notification-item`, `activity-item`, `message-item`, and `user-post-item`.
- Continue rejecting explicit activity/notification phrases such as `liked your video`, `commented on your post`, `followed you`, and similar personal-event copy.
- Continue canonicalizing TikTok evidence to exact `/@author/video/<id>` URLs.
- Add observer diagnostics for raw video anchors, feed-container count, accepted anchors, and rejection reasons so `0 observed` can no longer be silent/ambiguous.
- Add a regression test proving current `recommend-list-item-container` feed cards remain eligible while local inbox/notification/user-post containers are rejected.

## Release gate

The release validator must fail closed unless all of the following are true:

1. Browser-bridge regression suite passes.
2. Production application build passes.
3. Chrome CDP attaches to the existing Front Chrome profile.
4. X opens the authenticated home surface and collects real status URLs.
5. TikTok stays on a discovery surface, renders real video anchors, and the feed filter admits them.
6. TikTok is not login-walled or challenged.
7. A fresh deep scan completes without pipeline errors.
8. X and TikTok both contribute evidence.
9. TikTok produces grounded video evidence and no activity/notification leakage.
10. Visual/Qwen understanding is actually exercised with no visual-analysis failures.
11. Contextual post understanding is exercised with no model failures.
12. Narrative ranking and origin research complete.
13. Final evidence contains canonical URLs, multiple creators, no duplicate platform+URL rows, and no personal notification text.
14. Content-understanding health remains healthy/cached-ready and no malformed URL cache poison reappears.
15. The finished scan is persisted to the ledger and agrees with the final response counts/status.

Run the gate with:

```bash
npm run validate:v26-release
```

A merge/release should not proceed unless it ends with:

```text
✅ FRONT v26 RELEASE GATE PASSED
```
