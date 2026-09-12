# Front Video Content Detection Skill v17

## Objective
Understand what a social post is actually about when captions/hashtags are weak, misleading, or absent. Use the visual timeline as evidence for narrative detection without weakening Front's independent-creator and provenance gates.

## Operating contract
1. **Select before spending.** Analyze only the highest-value video posts: For You/investigation posts, fast posts, high-engagement posts, weak-caption posts, and posts already connected by sounds/visual context. Diversify across independent creators.
2. **Watch the timeline, not just the thumbnail.** Seek across the full video duration. Short videos receive dense sub-second/near-second sampling; longer videos receive evenly distributed representative frames. Preserve chronological order and timestamps.
3. **Ground the interpretation.** Combine frames with the source caption, author/platform context, sound title/ID, page title, and available caption-track text. Do not invent speech, location, backstory, or identities.
4. **Identity rule.** Never identify a real person from appearance alone. A name may be used only when source caption/page text/on-screen text supports it.
5. **Describe the event.** Extract a specific 1–2 sentence summary, short event phrase, visible entities/objects, actions, on-screen text, repeated visual motifs/templates, confidence, uncertainties, and meme potential.
6. **Fail closed.** If confidence is below 0.50, do not rewrite evidence text or use the model output to form a narrative.
7. **Preserve the hard narrative gate.** Visual understanding is additional evidence, not permission to promote one creator. Candidate narratives still need independent creators and existing Front quality rules.
8. **Cache visual understanding.** Video content is mostly static; reuse a successful analysis for seven days so repeated scans do not pay to understand the same clip again.
9. **Budget caps.** Deep scans analyze up to four selected videos by default; Scout/background passes analyze two. Provider/model and caps are configurable locally.
10. **Private provider config.** API keys live only in `~/.front-browser-bridge/content.env`. Never put them in the cloud Settings page, logs, scan payloads, or repository.

## Frame strategy
- <=12 sec: dense timeline sweep, roughly one sample every 0.75 sec, max 16 frames.
- 12–30 sec: roughly one sample every 1.5 sec, max 16 frames.
- >30 sec: 16 evenly distributed timeline samples.
- At most 12 representative frames are sent to the multimodal model per analysis; the full local capture count is retained in audit metadata.

This intentionally avoids sending every 30/60-fps source frame to a remote model. Doing so would multiply cost and latency while adding many near-identical images. The detector still covers the full timeline and preserves ordering, which is the useful definition of "watching the whole video" for narrative detection.

## Provider behavior
- `FRONT_CONTENT_PROVIDER=openai`: use `FRONT_CONTENT_API_KEY` (or `OPENAI_API_KEY`) with `FRONT_CONTENT_MODEL`, default `gpt-5.6-luna`.
- `FRONT_CONTENT_PROVIDER=ollama`: use a user-installed local vision model from `FRONT_OLLAMA_MODEL` at `FRONT_OLLAMA_ENDPOINT`.
- No provider: Front continues scanning normally. v17 reports semantic video understanding as inactive rather than fabricating a result.

## Promotion safety
The model's summary is appended to source evidence only when confidence >=0.50. Standardized analysis labels are stripped before topic detection so phrases such as "visual summary" cannot accidentally become narratives. Newly derived topics still pass `detectTopics`, creator-count, junk-label, semantic cross-platform, and later production feed gates.
