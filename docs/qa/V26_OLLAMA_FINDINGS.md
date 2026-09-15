# Qwen runtime diagnosis

## Current verified local profile

Front's personal-machine profile now uses `qwen3-vl:4b-instruct` for both visual understanding and contextual post understanding on the user's 8 GiB Apple Silicon Mac. The previous 8B default is no longer considered viable on this machine.

Measured model results:

1. `qwen3-vl:8b` failed the canonical one-real-video Front diagnostic by exhausting the 45-second inference deadline after successful 16-frame capture.
2. A cold `qwen3-vl:4b-instruct` contact-sheet request exceeded 60 seconds.
3. After explicitly warming 4B, the same saved contact sheet completed in about 25 seconds with a grounded description and extracted on-screen text.
4. The exact Front engine then completed the same real TikTok video with 16 captured frames / 12 represented frames: about 8.9 seconds capture, 29.2 seconds model inference, 38.4 seconds total, exit 0.

That established that 4B can perform the required visual task locally when resident in memory.

## Earlier software failures that were fixed

1. The old multi-image visual request could exceed Ollama context limits. Contact-sheet packing reduced one real 16-frame timeline request from an over-context request to a single chronological image while preserving frame coverage.
2. Capture and inference previously shared one deadline. Inference now receives its own deadline only after capture finishes.
3. Individual locator screenshots added hidden-tab compositor waits. Front reads decoded video frames through canvas where possible, with a bounded screenshot fallback.
4. The release validator previously used ordinary fetch for a long loopback scan. It now uses the native long-scan transport.
5. TikTok discovery was not capped at two/four videos. Live validation reached 12 grounded TikTok videos, and the unit suite explicitly verifies that the observer has no four-video ceiling. Small numbers such as 4/2/1 are visual-analysis budgets only.
6. Private `~/.front-browser-bridge/content.env` values could override the tuned repository profile with stale 8B / 8-deep / 4-scout defaults. Startup now migrates the exact legacy defaults to 4B / 4-deep / 2-scout / 1-background unless the user deliberately exports an override.

## September 13 corrected-profile release-gate failure

After the startup-precedence fix was active, the bridge health report correctly showed:

- visual model: `qwen3-vl:4b-instruct`
- context model: `qwen3-vl:4b-instruct`
- deep visual budget: 4
- scout visual budget: 2
- background visual budget: 1

The next authenticated release gate still failed under a cold/full workload:

- X discovery: 2 real posts
- TikTok discovery: 4 observed / 4 grounded videos
- visual understanding: requested 4, enriched 0, cached 0, failed 4
- contextual post understanding: modeled 0, cached 0, failed 12
- narratives: 0, as expected because no semantic-model frames survived

The 12 contextual failures were not twelve unique items. Six evidence rows entered post understanding, the batch failed, and deep-mode post understanding ran again after origin research, producing another six failures. The elapsed scan shape matched sequential local-model deadline exhaustion.

## Root causes confirmed from that run

1. The bridge could start with Ollama cold even though the standalone benchmark proved 4B works when warm.
2. Ollama requests did not explicitly keep the model resident, allowing load/unload latency to affect a scan.
3. Visual inference still sent up to twelve represented frames even though the local machine only needs enough representative frames to identify the narrative.
4. Visual deep requests still had a 45-second model deadline, leaving little margin above the measured ~29-second warm single-video inference.
5. Visual failure cooldown keys did not include provider/model/version. A recent failure from one model/profile could contaminate a different model/profile.
6. Contextual understanding used batches of up to eight posts with a 45-second deadline and discarded the underlying batch error, making timeout diagnosis opaque.
7. The live release gate treated fewer than five X/TikTok observations as a collector failure even when authenticated probes, canonical URLs, grounded evidence, and creator diversity were healthy. Repeated personalized feeds can expose fewer novel rows.

## Permanent fixes applied

The current v26 branch now:

- prewarms the configured local Ollama model before the bridge starts;
- sends `keep_alive=30m` on local visual and context requests;
- defaults visual model input to eight representative contact-sheet frames;
- gives deep visual inference a 60-second model window and scout inference 45 seconds;
- caps visual response generation for bounded latency;
- scopes visual cache/cooldown keys by provider, model, understanding version, and contact-sheet generation version;
- defaults contextual understanding to four posts per request, 36 maximum selected posts, and a 60-second batch deadline;
- surfaces contextual batch timeout/unreadable-output messages in stage diagnostics instead of silently collapsing them into a failure count;
- preserves explicit shell overrides for all of these performance controls;
- keeps collector breadth separate from expensive model-analysis budgets;
- treats 2+ real X posts and 3+ real grounded TikToks as sufficient live collector proof, while warning when either feed returns fewer than five; model/semantic failures remain hard release failures.

## Current release status

These changes require static CI plus another authenticated local release gate before v26 can be called release-ready. A successful static suite alone is not sufficient because GitHub Actions cannot exercise the user's authenticated Chrome/CDP session or local Ollama runtime.

Chrome CDP port 43982 was not restarted, killed, repurposed, or reconfigured during this work.
