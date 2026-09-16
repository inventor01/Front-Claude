# Front v31 — semantic child-signal dedupe and truthful ledger schema

## Trigger
Authenticated v30 scan `v26-1789579562251-wgirxs` completed with 90 usable evidence items, 59 transcripts, 12 understanding frames, zero errors, zero internal-label leaks, and zero raw lexical fallback signals. The near-match engine correctly formed one two-creator pre-breakout narrative: `Criminal Breaks Handcuffs: Throat-punches Deputy`.

The final signal list also contained a separate singleton WATCH signal, `man breaks handcuffs`, representing one child semantic key from the same two-post cluster.

## Root cause
`deriveSemanticNarrativesV26()` correctly emitted a v30 cluster with `semanticClusterKeys`, but `buildScanSignals()` later regrouped evidence by each exact `semanticNarrativeKey`. Because final dedupe only removed signals with identical evidence-ID sets, a one-row child group was not considered a duplicate of its two-row parent cluster.

Separately, `buildScanLedgerEntry()` populated the field named `inferredTopics` from the numeric `latestLive.candidateTopics` value instead of the actual `latestLive.inferredTopics` array. This did not change narrative detection but made diagnostics misleading.

## Permanent fix
- Build an owner map from each engine narrative's representative key and `semanticClusterKeys`.
- Route exact-key semantic groups back into their engine cluster before final signal ranking.
- Preserve the parent cluster's title, detector, thresholds, evidence, and creator counts.
- Do not lower candidate or corroboration thresholds.
- Store the actual inferred-topic array in `ledger.inferredTopics` and expose `inferredTopicCount` separately while retaining the existing `candidateTopics` field.

## Regression coverage
Tests verify that:
- near-match child keys do not reappear as singleton duplicate signals;
- the parent cluster retains both creators and both evidence IDs;
- raw lexical fallback suppression remains intact;
- the ledger stores the actual inferred-topic array separately from the candidate-topic count.
