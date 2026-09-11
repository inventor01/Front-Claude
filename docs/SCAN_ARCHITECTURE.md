# Front deep-scan architecture

Front should not treat a platform's Trending page as ground truth. Trending pages are useful seeds, but they are usually late relative to the earliest meme/narrative formation and they reflect each platform's own ranking rules.

## Discovery loop

1. **Seed**
   - X Explore trends
   - TikTok Creative Center trends
   - TikTok Explore fallback
   - configured X accounts and user keywords

2. **Sample the underlying feeds**
   - bounded scrolling of X Home
   - bounded scrolling of TikTok Explore
   - collect post/video text, author, URL, timestamp when available, views/likes when available
   - dedupe by platform + canonical URL

3. **Infer candidate topics from the sampled corpus**
   - hashtags carry the highest phrase weight
   - repeated names/title-case phrases are secondary candidates
   - repeated 2–3 word phrases provide discovery when a meme has no hashtag yet
   - a candidate must occur in at least two evidence records from at least two distinct creators before Front promotes it as an inferred topic

4. **Corroborate**
   - take only the strongest inferred topics
   - run bounded X Latest and TikTok searches for each
   - add those results back into the evidence corpus
   - recompute the ranking after expansion

5. **Promote to Narrative Radar**
   - store the underlying evidence first
   - create a narrative only from explicit trend evidence or a corroborated inferred topic
   - retain the evidence links so the user can inspect why the narrative exists

6. **Measure momentum rather than inventing virality**
   - distinct creator count
   - evidence count
   - number of platforms
   - recency / earliest dated evidence
   - reported engagement when available
   - observed view velocity when multiple observations exist
   - missing metrics stay unknown

7. **Correlate with coins**
   - search related Solana market indexes for the narrative aliases
   - keep every result labeled as a candidate association until stronger evidence exists
   - never imply that a same-name coin is the original or official coin

8. **Watch new Pump.fun creation events**
   - use PumpPortal `subscribeNewToken`
   - accept only events where `txType === "create"`
   - exact-normalized name matches to active narrative titles/aliases can trigger a narrative-launch alert
   - surface direct Pump.fun and Axiom links

9. **Repeat and compare**
   - the local bridge schedules scans using `intervalMinutes`
   - when Front's web page is closed, scheduled evidence is kept in a capped local queue rather than giving the bridge the user's Front session credentials
   - when Front is open, pending evidence is synced through the authenticated same-origin ingestion endpoint

## Why bounded scrolling is better than infinite scrolling

Infinite scrolling is not a good trend detector. It creates a biased, expensive sample, repeatedly consumes personalized recommendations, increases platform friction, and can make scan duration unpredictable. Front therefore uses a configurable but bounded number of scroll passes and feed items. The goal is to sample enough independent posts to identify repetition, then use targeted searches to validate the candidate narrative.

The important change is **sample → infer → corroborate**, not simply “scroll more.” A narrative should rise because independent evidence converges on it.

## Current safety boundaries

- no CAPTCHA bypass
- no login-challenge bypass
- no anti-bot evasion
- no rate-limit bypass
- no password/cookie upload
- Chrome DevTools endpoint remains bound to loopback
- browser evidence may be incomplete if a platform changes markup or withholds content

## Next quality layer

The deterministic phrase model is intentionally cheap and explainable. If Front later needs better semantic grouping, the recommended upgrade is to run an optional low-cost semantic consolidation step **only on the top few corroborated candidates**. It should merge aliases such as different spellings of the same meme after the evidence has already been collected; it should not replace the evidence or invent a trend. This keeps recurring AI cost small and makes the model an organizer, not the source of truth.
