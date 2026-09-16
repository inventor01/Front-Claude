# Front v28 Title Intelligence Acceptance Checklist

Before merge, validate at least one real authenticated scan against these semantics:

- A title names a person/entity only when multiple independent creator rows support that identity.
- A displayed event/action is present in multiple independent creator rows.
- Cross-platform wording appears only when the same event/action has evidence on each named platform.
- Ambiguous competing identities are withheld rather than guessed.
- A weak or missing event falls back to a conservative subject-only title.
- Generic labels such as `viral video` never become the promoted narrative title.
- `titleConfidence`, `titleStatus`, `titleConsensus`, `titleEvidence`, `titleCandidates`, and `titlePolicy` are present on promoted narratives.
- Existing v27 transcript/video-meaning/post-understanding fields remain intact.

This semantic acceptance complements repository-wide CI; neither replaces the other.
