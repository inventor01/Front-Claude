# Qwen runtime diagnosis

Required model remains qwen3-vl:8b. No smaller model was substituted and no GPU setting was persisted.

Confirmed software failures:

1. The old visual request contained 13,199 tokens, but Ollama's configured context was 4,096. A fresh, real-video diagnostic captured 16 timeline frames in 9.8 seconds and received HTTP 400 `exceed_context_size_error`. Contact-sheet packing reduces the same timeline request to 2,520 tokens, verified in Ollama logs. Model image count and represented frame count are kept separate.
2. Capture and inference shared one deadline. Capture could exhaust the signal before inference began, cancelling cold model loads. Inference now gets its own deadline after capture. A regression test holds capture longer than the model deadline and proves the subsequent model request begins with an unexpired signal.
3. Individual locator screenshots add compositor waits. Reading decoded video frames through canvas succeeded on the actual TikTok video and produced a real frame; bounded screenshot fallback remains for cross-origin restrictions.
4. The release validator used ordinary fetch for a long scan, which failed before the scan's configured overall deadline. It now uses the existing native loopback scan transport (already regression-tested).

Remaining runtime limitation:

- Hardware: Apple M1, 8 GiB physical memory.
- Measured swap usage: approximately 10.7 GiB initially, later 10.1 GiB.
- Default runtime loaded only 8/37 text layers to GPU.
- A tiny 27-token text prompt, with thinking disabled and output capped at 64 tokens, did not complete in 180 seconds.
- An isolated request using 28 GPU layers did not complete in 240 seconds (only five generated tokens before cancellation).
- Ollama 0.34.0 logs explicitly disable multimodal projector GPU offload for explicit partial text-offload settings. Thus increasing partial layer count is not a validated visual-performance fix and was not saved to Front settings.
- The corrected 2,520-token visual request fits context but still timed out during image encoding at 45 seconds.

These are measured failures, not a Qwen pass. Memory pressure is a significant observed constraint; the remaining inference latency has not been eliminated. Chrome CDP was not restarted or reconfigured. The user was asked whether they could free nonessential application memory while retaining the required model and dedicated browser.
