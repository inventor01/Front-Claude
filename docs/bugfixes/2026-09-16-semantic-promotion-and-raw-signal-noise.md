# Semantic promotion missed near-matches while raw word pairs crowded scan signals

## Production evidence

Authenticated scan `v26-1789572008611-1p9m4l` produced 90 usable evidence rows, 60 transcripts, and 12 understanding frames. The v29 internal-label guard worked: no `meaning`, `subject`, `event`, or other internal field label leaked into the final signals.

However, the ledger contained low-value raw labels such as `spoken transcript`, `beat music`, and `full watch`, while the final narrative engine returned zero candidates.

## Root cause

Two independent mechanisms were involved:

1. `scan-signals-v26.mjs` generated every two-word combination from repeated caption/transcript terms and appended those raw repeats even when model-backed semantic signals already existed. Arbitrary common word pairs could therefore occupy the limited signal list and make the output look more meaningful than the evidence supported.
2. `deriveSemanticNarrativesV26()` grouped post-understanding results only when `semanticNarrativeKey` matched exactly. Two creators could describe the same event with nearly identical but not byte-identical semantic keys and fail to corroborate each other.

The zero-candidate result itself is not automatically an error. Front intentionally requires independent creator corroboration; singleton stories must remain singletons.

## Permanent fix

- Raw lexical word-pair signals are now a last-resort fallback. When an engine or post-understanding semantic signal exists, arbitrary raw pairs are not added.
- Semantic narratives may now cluster conservative near-matches across independent creators when:
  - subject terms strongly overlap;
  - at least two meaningful subject terms agree; and
  - the semantic keys, event fingerprint, or entity evidence also agrees above strict thresholds.
- Exact semantic-key grouping remains supported.
- The creator thresholds are unchanged: at least two independent creators are required to create a semantic narrative, and three creators are still required for candidate-tier corroboration.
- The v28 title consensus layer remains the final title gate. Near-match clustering does not bypass title evidence requirements.

## Regression coverage

- model-backed semantic signals suppress raw pair noise such as `beat music` and `full watch`;
- near-identical semantic descriptions from two independent creators cluster as a pre-breakout narrative;
- unrelated stories that share only a broad actor/action do not cluster;
- one semantic post cannot become a narrative by itself;
- exact semantic keys retain the existing two-creator threshold.
