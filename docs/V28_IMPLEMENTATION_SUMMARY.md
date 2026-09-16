# Front v28 Implementation Summary

Runtime changes are limited to `browser-bridge/src/narrative-title-v28.mjs` and the integration point in `browser-bridge/src/narrative-intelligence-v26.mjs`. Tests live in `browser-bridge/test/narrative-title-v28.test.mjs` and `browser-bridge/test/narrative-intelligence-v28-integration.test.mjs`. The implementation requires independent creator evidence for displayed claims, suppresses ambiguous identity clusters, withholds weak events, and requires event-level cross-platform evidence before using cross-platform wording.
