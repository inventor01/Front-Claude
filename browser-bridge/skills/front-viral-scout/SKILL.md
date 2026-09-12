# Front Viral Narrative Scout

## Purpose

Front is not a generic scraper. The scout's job is to notice an emerging internet event, meme, person, quote, visual, sound, or remix **before** it is obvious, then switch from broad scrolling to targeted investigation as soon as the evidence justifies it.

The operating loop is:

**Scout → Focus → Investigate → Verify Origin → Monitor**

The skill controls what the browser should look for and when to stop scrolling. Deterministic code still owns quality gates: creator independence, generic-word rejection, timestamps, duplicate handling, narrative promotion, and Pump.fun verification.

## 1. Scout

Primary discovery surfaces are X For You and TikTok For You. Trend pages are seeds, not evidence of independent spread.

While scrolling, collect each real post/video with as much of this evidence as available:

- platform, creator, canonical URL and content/caption
- actual publish timestamp; never replace a missing timestamp with discovery time
- views, likes, comments, reposts/quotes/shares/saves
- creator follower count when available
- sound ID/title/author
- visual fingerprint or poster/cover fingerprint
- quoted/origin URL, duet/stitch/derived-video ID and outbound URLs
- discovery timestamp and provenance

### What deserves attention

Increase attention when one or more of these occurs:

- a post is gaining unusually fast engagement for its age
- 100K+ views arrive within a few hours
- multiple independent creators discuss the same specific event in a short window
- the same visual, clip, quote, sound, duet/stitch parent or outbound link repeats
- the same event appears on both X and TikTok
- creator count is increasing between scans
- a niche phrase/entity begins appearing repeatedly on recommendation surfaces

A single viral creator is evidence of a viral post, **not yet a narrative**.

### What to ignore

Do not turn platform/UI text, common words, engagement labels, generic hashtags, ads, search suggestions, or audio attribution into narratives. Examples include `original sound`, `sonido original`, `viral`, `trending`, `video`, `created`, generic verbs/adjectives, and equivalent multilingual boilerplate.

Hashtags and trend pages can seed searches, but cannot by themselves satisfy independent-creator support.

## 2. Focus

Scrolling is adaptive, not quota-driven. Do not keep scrolling only because a configured scroll cap has not been reached.

After each feed pass, evaluate whether a specific signal is strong enough to focus. Focus when there is evidence such as:

- repeated specific language across at least 3 independent creators
- repeated media/context across at least 2 independent creators
- multiple fast posts from independent creators
- one fast post plus independent repetition of the same event

When a focus signal appears after a minimum useful sample, stop the broad feed pass early and preserve the audit reason (`signal-found`).

If no focus signal appears, continue until the unique-post target, stale-pass limit, scroll cap, or time cap.

## 3. Investigate

Rank investigation candidates using **event evidence**, not raw keyword frequency. Prefer:

1. fast measured velocity
2. independent creator growth
3. same-event X ↔ TikTok corroboration
4. repeated visual/sound/quote/URL/duet context
5. recommendation-feed penetration growth
6. specificity of the entity/phrase
7. prior source quality as a small tie-breaker

For each top candidate, search natural aliases and spelling variants on both X and TikTok. Search results must still be treated as evidence records; a search hit is not automatically corroboration.

## 4. Verify Origin

For qualified deep investigations, look for the earliest dated supporting post and ancestry links such as quotes, repost chains, duets, stitches and derived videos.

Origin confidence must distinguish:

- earliest supporting post Front found
- likely origin
- confirmed origin

Never claim an absolute origin from incomplete social search coverage.

## 5. Monitor

Revisit qualified narratives on later scans to measure real growth. When a platform does not expose a publish timestamp, calculate velocity only from two real metric snapshots separated in time. Never infer a post's age from when Front first saw it.

Track whether creator count, evidence count, feed penetration, views/likes, visual replication and cross-platform corroboration are accelerating or cooling.

## Pump.fun rule

Narrative detection comes first. Coin search comes afterward.

Only PumpPortal `subscribeNewToken` / `txType=create` events can establish Pump.fun launch provenance. DEX data is enrichment for an already verified mint. Exact/Strong matching requires semantic alignment with the actual narrative/entity; generic string similarity is insufficient.

## Stopping rules

A discovery pass stops when the first applicable condition is met:

1. a high-confidence focus signal appears after a minimum sample
2. enough unique new posts have been collected
3. repeated scrolling produces little/no new evidence
4. the scroll cap is reached
5. the time cap is reached

The goal is not maximum scrolling. The goal is the fastest reliable transition from broad discovery to evidence-backed investigation.