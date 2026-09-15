#!/usr/bin/env node
process.env.FRONT_RELEASE_GATE = '27';
await import('./v27-disk-preflight.mjs');
console.log('\nFRONT v27 AUTHENTICATED RELEASE GATE');
await import('./validate-v26-release.mjs');
