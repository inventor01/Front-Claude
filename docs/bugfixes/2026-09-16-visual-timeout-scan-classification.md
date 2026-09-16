# Visual timeout incorrectly failed otherwise usable scans

## Root cause

`scan-outcome-v26.mjs` treated every stage marked `degraded` as an overall scan failure. The deep `visualUnderstanding` stage can legitimately degrade when a single optional deep visual analysis times out, even when authenticated discovery, transcription, all-video meaning, post understanding, and narrative processing continue successfully.

That caused evidence-bearing scans to be labeled `failed` because of a single visual timeout. Since narrative memory is persisted only for scans whose final status is `complete`, the misclassification also prevented otherwise valid scan learning from being retained.

## Permanent fix

- Keep a fully failed `visualUnderstanding` stage release-blocking.
- Treat only a partially degraded `visualUnderstanding` stage as non-fatal when the scan has usable evidence.
- Preserve the visual timeout in scan diagnostics as a warning so it remains observable.
- Keep degraded failures in critical stages such as `videoMeaning` release-blocking.
- Keep zero-observation requested collectors release-blocking.

## Regression coverage

`browser-bridge/test/scan-outcome-v26.test.mjs` now verifies:

1. one partial visual timeout with usable evidence completes with a warning;
2. a fully failed visual stage still fails;
3. degraded critical model stages still fail;
4. empty requested collectors still fail.

## Production incident

Observed on scan `v26-1789572008611-1p9m4l`, which reached `video-meaning` and `post-understanding` but was ultimately classified `failed` solely because `visualUnderstanding` reported one `Content analysis timed out.` failure.
