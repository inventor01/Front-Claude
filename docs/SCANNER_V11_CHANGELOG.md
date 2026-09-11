# Front Scanner v11 — Root Cause / Permanent Fix Log

## Automatic Scout → Deep escalation

### Root cause
Scheduled scans stopped at Scout mode. Scout performed limited candidate investigation, but there was no production rule that promoted a strong Scout result into the same full Deep path available from the web panel. Strong cross-platform or rapidly accelerating topics could therefore wait until a person manually pressed Deep Scan.

### Permanent fix
- Score Scout outputs for cross-platform corroboration, recommendation-feed penetration velocity, creator/evidence acceleration, repeated TikTok sounds and repeated visual templates.
- Automatically launch a full Deep scan when a Scout crosses those conditions.
- Add a 45-minute per-topic cooldown so one noisy topic cannot continuously retrigger expensive Deep work.
- Preserve the escalation reason in scan audit metadata.

## Semantic / alias clustering

### Root cause
Variant consolidation relied mostly on normalization, edit distance, token overlap and shared sounds. Captions describing the same meme with different wording could remain split even when they shared evidence/media context.

### Permanent fix
- Add zero-API local semantic feature vectors built from distinctive words, phrase bigrams and character trigrams.
- Merge candidate topics using semantic similarity plus evidence overlap, shared sounds, perceptually similar visuals, shared outbound URLs or shared parent/quoted content.
- Keep strict merge thresholds so broad one-word topics do not collapse unrelated narratives.
- Retain existing conservative fuzzy alias consolidation as a second pass.

## Richer X / TikTok metadata

### Root cause
The scanner persisted engagement and media metadata, but did not consistently record creator audience size, external/shared URLs or TikTok duet/stitch ancestry.

### Permanent fix
- X evidence now captures external outbound URLs and quoted-post relationships.
- Deep scans enrich creator follower counts from authenticated X/TikTok profile pages with a six-hour local cache.
- TikTok JSON parsing records follower counts when exposed directly and captures duet/stitch/derived parent video IDs when present.
- Persist these fields in `evidence_rich` and expose them through narrative detail.

## Visual meme-template similarity

### Root cause
Front stored TikTok cover URLs and media type but did not compare visuals, so recurring meme templates with different captions/audio could be missed.

### Permanent fix
- Compute a 64-bit difference hash from X image/video posters and TikTok cover images using the authenticated browser itself; no paid vision API is required.
- Cache visual hashes locally for seven days.
- Group near-identical hashes by Hamming similarity and attach repeated visual-template signals to topics.
- Allow strong shared visual context to assist semantic merging while still requiring supporting narrative similarity/evidence.

## Origin research

### Root cause
The original origin candidate was simply the earliest dated evidence already present in the scan. That was honest but too passive: Front was not deliberately searching older alias matches or following quoted/parent evidence.

### Permanent fix
- Full Deep scans now run dedicated multi-scroll X and TikTok origin searches for the strongest narrative aliases.
- X quoted-post ancestry is opened directly when available and added as origin evidence.
- Origin confidence now reflects targeted-origin evidence quantity and cross-platform support.
- Front still labels the result as its **earliest verified find**, never as a guaranteed absolute internet origin.

## Regression / release gate

The release must pass:
- scanner semantic / visual / origin / escalation unit tests,
- existing browser-bridge regression tests and Chromium smoke,
- D1 migrations including `0007_scanner_intelligence_v11.sql`,
- TypeScript typecheck,
- lint,
- production build,
- Railway deploy + `/api/health` after merge.
