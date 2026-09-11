# Scanner v11 QA

This pass closes the gap between collection and what the user can inspect in Narrative Workbench.

## Required behavior

- Narrative detail keeps raw evidence as the source of truth.
- The latest `evidence_rich` observation is joined to each evidence item without replacing raw content.
- For You penetration data comes from `topic_rich_snapshots`; missing fields remain unknown rather than becoming zero.
- Narrative Workbench exposes, when available: replies, reposts, quotes, comments, shares, saves, media type, feed surface, quoted post, hashtags, TikTok sound, feed penetration, penetration change, and penetration velocity.
- The UI must label For You penetration as a sample metric, not total internet market share.
- Existing PumpPortal launch matching, narrative evidence, coins, and timing edge must remain unchanged.

## Release gate

CI must pass migrations, tests, browser bridge health smoke, typecheck, lint, production build, and deploy-bundle verification before merge.
