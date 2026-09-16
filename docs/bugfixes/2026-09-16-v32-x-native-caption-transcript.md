# v32 — X native-caption transcript cleanup

## Root cause

X video text tracks can expose cue text wrapped in proprietary timed-word markup such as `<X-word-ms ms=... index=... character_ranges=...>spoken words</X-word-ms>`. `video-transcript-v27.mjs` previously treated cue text as already-clean speech: `normalizeTranscript()` only removed bracketed non-speech markers and whitespace. The timing/index markup therefore leaked into the UI and into downstream transcript consumers.

A second issue made the problem more important than a display bug: when any native caption track existed, `transcribeOne()` accepted it as authoritative and skipped local Whisper, even when authenticated X media/audio was available. Dirty or inaccurate native auto-captions could therefore become the canonical transcript and remain cached for up to seven days.

## Permanent fix

- Strip X `<X-word-ms ...>` timing/index markup while preserving the enclosed spoken text.
- Strip common WebVTT timestamps/formatting and decode caption entities before storing transcripts.
- Normalize cached transcript text when it is read.
- Treat old X `native-caption-track` cache entries as stale when full local speech-to-text is available.
- Prefer local Whisper for X when authenticated media candidates are available.
- Keep the sanitized native caption as a fallback if local audio acquisition/Whisper cannot produce a transcript.
- Keep TikTok behavior unchanged; the Whisper preference is X-specific.

## Regression coverage

`browser-bridge/test/x-caption-transcript-v32.test.mjs` uses the actual `<X-word-ms ...>` format observed in production and verifies that timing/index metadata never survives normalization. It also verifies the X-only Whisper preference policy.
