# Signal quality hardening

This note captures the next discovery-quality gate after the unified dashboard release.

## Root causes observed

- TikTok Creative Center cards can expose generic labels such as `Hashtag` before the actual trend slug/title.
- TikTok Explore anchors can expose view-count text such as `743.6K` when structured video metadata is unavailable.
- X cards without a real tweet body can fall back to author/display-name UI text.
- Early-candidate extraction favored hashtags/proper-case phrases and could miss repeated lowercase single-token entities.

## Permanent rules

1. Prefer platform-native content fields; if no real post/caption exists, skip the item instead of using surrounding UI text.
2. Reject numeric-only, metric-only, generic taxonomy labels, usernames/display names, and navigation chrome both at collection time and at display time.
3. Derive Creative Center hashtag titles from the canonical trend URL slug when available.
4. Permit lowercase single-token candidates only after independent repetition across creators (or strong cross-platform corroboration); do not promote them from one post.
5. Keep raw evidence separate from topic labels. A post can be valid evidence without its whole caption becoming the displayed topic.
6. Preserve broad context as related context rather than making it compete with niche narratives.

## Quality target

The dashboard should prioritize specific, human-readable entities/phrases that recur independently, while suppressing UI artifacts and engagement counts. Missing a single weak item is preferable to presenting a number, button label, or username as a topic.
