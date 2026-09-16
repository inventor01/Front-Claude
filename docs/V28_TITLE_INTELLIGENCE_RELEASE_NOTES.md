# Front v28 Title Intelligence Release Candidate

This branch changes only narrative title selection and title metadata. It does not alter the v27 authenticated X/TikTok collectors, transcription engine, video meaning engine, post-understanding model path, origin research, PumpPortal listener, or production deployment configuration.

The candidate replaces heuristic title selection with independently corroborated subject/event consensus, contradiction suppression, conservative spelling-variant grouping, claim verification, and event-specific cross-platform proof. Existing `intelligenceVersion: 26` remains unchanged for compatibility; the new title subsystem reports `titleIntelligenceVersion: 28`.

Focused pre-push QA passed 10/10 tests with 0 failures plus syntax checks. Full repository CI and one real authenticated semantic acceptance scan are required before merge.
