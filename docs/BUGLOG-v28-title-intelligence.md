# Front v28 Title Intelligence Bug / Fix Log

## 2026-09-16 — Narrative titles could sound more certain than the evidence

### Root cause
The v26 title selector scored candidate strings using repetition, lexical specificity, and title length. That was useful for rejecting generic hashtag-style labels, but it did not prove every displayed claim. A repeated subject could dominate even when an event description was weak or contradictory, and platform presence at the subject level was not the same as proof that the same event was spreading on both platforms.

### Permanent fix
- Add a dedicated `narrative-title-v28` evidence-consensus layer after post understanding.
- Require independent creator corroboration for the displayed subject and any displayed event.
- Penalize/withhold titles when competing subject clusters are too close to call.
- Preserve conservative one-edit spelling-variant grouping for emerging names such as DeJon/Daejon.
- Generate and rank multiple candidates, but only from pre-verified claims.
- Keep cross-platform wording out unless the event itself is represented across multiple platforms with sufficient independent spread.
- Expose title confidence, status, consensus, evidence IDs, creators, platforms, claim list, alternatives, and policy in the narrative object.
- Preserve the existing narrative intelligence contract version (`26`) and version the title subsystem independently (`28`).

### Regression / release gate
Focused pre-push QA covers: specific corroborated title generation; weak-event omission; contradictory-subject rejection; same-author repetition rejection; conservative cross-platform behavior; event-specific cross-platform verification; one-edit spelling variants; generic-label rejection; and integration metadata shape. Repository-wide CI remains mandatory after branch push and before merge.
