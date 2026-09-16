#!/usr/bin/env node
process.env.FRONT_RELEASE_GATE = '27';
const e2eTimeoutMs = Math.max(120000, Number(process.env.FRONT_E2E_TIMEOUT_MS || 720000));
const requestedProxyTimeoutMs = Math.max(0, Number(process.env.FRONT_SCAN_PROXY_TIMEOUT_MS || 0));
process.env.FRONT_SCAN_PROXY_TIMEOUT_MS = String(Math.max(e2eTimeoutMs, requestedProxyTimeoutMs));
await import('./v27-disk-preflight.mjs');
console.log('\nFRONT v27 AUTHENTICATED RELEASE GATE');
console.log(`Loopback scan proxy timeout: ${Math.round(Number(process.env.FRONT_SCAN_PROXY_TIMEOUT_MS) / 1000)}s`);
await import('./validate-v26-release.mjs');
