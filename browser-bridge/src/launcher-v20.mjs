const cdpCompatUrl = new URL('./playwright-cdp-compat.mjs', import.meta.url).href;
const scanFetchCompatUrl = new URL('./loopback-scan-fetch-compat.mjs', import.meta.url).href;
const preloads = [
  `--import=${cdpCompatUrl}`,
  `--import=${scanFetchCompatUrl}`,
];
const existing = String(process.env.NODE_OPTIONS || '').trim();
const options = existing ? existing.split(/\s+/) : [];
for (const preload of preloads) if (!options.includes(preload)) options.push(preload);
process.env.NODE_OPTIONS = options.join(' ');

// Keep the established v19 scanner-tree ports stable for local diagnostics.
// v20 owns 43981, Chrome CDP stays on 43982, and v19 moves behind v20 to 43987.
process.env.FRONT_BRIDGE_V19_PORT ||= '43987';
process.env.FRONT_BRIDGE_V18_PORT ||= '43988';
process.env.FRONT_BRIDGE_V17_PORT ||= '43991';
process.env.FRONT_BRIDGE_INTERNAL_PORT ||= '43994';
process.env.FRONT_BRIDGE_CDP_PORT ||= '43982';

// Preload transport compatibility layers in this process and every child process
// in the v20 -> v19 -> v18 -> v17 -> v16 scanner tree. The CDP shim skips
// unsupported default-context setup. The loopback transport prevents Node's
// five-minute fetch headers timeout from terminating a legitimate deep scan and
// retrying POST /scan. Live-preview sanitation only needs to patch the v20
// observer in this process, so it is imported directly instead of preloaded into
// every child scanner process.
await import('./playwright-cdp-compat.mjs');
await import('./loopback-scan-fetch-compat.mjs');
await import('./live-preview-compat.mjs');
await import('./server-v20.mjs');
