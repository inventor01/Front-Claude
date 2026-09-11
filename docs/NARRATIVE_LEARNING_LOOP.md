# Front Narrative Learning Loop

Front should improve from labeled outcomes, not from blindly reinforcing its own predictions.

## What the system should learn from

1. **Human feedback**
   - Kept / watched narrative = positive label.
   - Hidden / deleted narrative = negative label.
   - Merge / rename = alias and clustering correction.
   - Manual narrative = strong positive example.

2. **Objective downstream outcomes**
   - Did a matching Pump.fun token launch after Front first detected the narrative?
   - How long before launch did Front detect it?
   - Did related coins gain liquidity, volume or market cap after detection?
   - Did creator count and cross-platform spread continue after the initial alert?
   - Did the topic disappear without further corroboration?

3. **Source reliability**
   - Which source types produce narratives that later corroborate?
   - Which hashtags/search seeds repeatedly create false positives?
   - Which creators/surfaces lead to early true positives?

## Safe adaptation model

Do not let production predictions directly train themselves. Keep a replayable labeled dataset and calculate threshold changes from completed outcomes.

A daily/weekly calibrator should compute precision and recall by detector type, source, creator count, platform count, freshness, and momentum window. It can propose or apply bounded weight changes inside safe limits. Every new weight set must pass the golden replay suite before becoming active.

## Feedback memory

The next learning layer should persist:

- `subject_key`
- `label`
- `verdict` (`relevant`, `irrelevant`, `duplicate`, `rename`)
- `source`
- `reason`
- `created`

Negative feedback should suppress exact/near-identical future labels. Positive feedback should preserve aliases and slightly boost matching clusters. Rename/merge feedback should improve canonicalization.

## Outcome score

For every detected narrative, store a scorecard:

- Front first-seen time
- earliest sampled evidence time
- creators at first alert
- platforms at first alert
- 15m / 1h / 6h / 24h creator growth
- first matching token launch time
- time advantage before launch
- first related-coin match time
- peak liquidity / volume / market cap in fixed windows
- final user verdict

This gives Front a measurable target: detect real narratives earlier while reducing false positives.

## Promotion calibration

Start with deterministic bounds:

- one-word narratives require stronger creator support than multi-word narratives;
- hashtags and trend pages are search seeds, never sufficient promotion evidence;
- cross-platform natural-language corroboration is worth more than repeated tags;
- repeated independent creators matter more than raw post count;
- stale candidates decay quickly;
- user-rejected labels are strongly penalized;
- manual/approved aliases receive a small bounded boost.

## Release gate

Before any learned weights become active:

1. replay the golden narrative fixture set;
2. verify junk rejection does not regress;
3. verify known positives still surface;
4. compare false-positive rate to the current production brain;
5. require CI, typecheck, lint and production build to pass;
6. record the model/weight version so every historical result is attributable to a specific detector version.

The goal is controlled self-improvement: more signal, less noise, and measurable earlier detection — not an uncontrolled feedback loop.
