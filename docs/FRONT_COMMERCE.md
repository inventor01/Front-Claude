# Front-Commerce Development Contract

## Purpose
This branch is an isolated commerce-intelligence derivative of Front. It exists to support the AI Employee OS, especially Product Research, Creative, and Distribution, without risking production Front.

## Production protection
- Production Front remains on `main`.
- Commerce work belongs on `front-commerce-dev` until explicitly reviewed.
- Do not merge experimental commerce heuristics into `main` merely because they compile.
- Do not change production scanner behavior to satisfy dropshipping requirements.
- Prefer additive APIs and adapters over invasive rewrites.

## Boundary
Front-Commerce is an intelligence system, not the AI Employee OS and not a product-launch authority.

Front-Commerce may identify:
- emerging commerce-adjacent narratives
- purchase-intent language
- creator/platform breadth
- trend age from observed evidence
- reusable creative formats
- social proof language
- evidence references

Front-Commerce must NOT independently claim:
- supplier reliability
- landed cost
- gross margin
- shipping reliability
- competitor saturation
- refund risk
- IP/trademark safety
- regulatory safety
- that a product should launch

Those are downstream Product Research responsibilities.

## Current API
`GET /api/commerce-intel`

Returns conservative `SIGNAL_ONLY` or `EARLY_CANDIDATE` opportunities based on authenticated Front evidence and topic snapshots.

## AI Employee OS contract
Rowan / Product Research may consume this endpoint as one evidence source.

Maya / Creative may consume creative patterns and source evidence.

Nova / Distribution may consume social-format intelligence.

No employee should treat Front-Commerce output as sufficient launch evidence.

## Next steps
1. Add a stable service-to-service authentication mechanism for Employee OS.
2. Add query-by-topic/product endpoint.
3. Add trend-velocity history from multiple snapshots.
4. Add explicit purchase-intent evidence details.
5. Add creative-pattern lineage and source links.
6. Add API schema/versioning.
7. Run build/lint/regression QA on this branch before any deployment.
