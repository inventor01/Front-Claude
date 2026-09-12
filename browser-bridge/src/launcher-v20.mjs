const compatUrl = new URL('./playwright-cdp-compat.mjs', import.meta.url).href;
const preload = `--import=${compatUrl}`;
const existing = String(process.env.NODE_OPTIONS || '').trim();
if (!existing.split(/\s+/).includes(preload)) process.env.NODE_OPTIONS = [existing, preload].filter(Boolean).join(' ');

// Keep the established v19 scanner-tree ports stable for local diagnostics.
// v20 owns 43981, Chrome CDP stays on 43982, and v19 moves behind v20 to 43987.
process.env.FRONT_BRIDGE_V19_PORT ||= '43987';
process.env.FRONT_BRIDGE_V18_PORT ||= '43988';
process.env.FRONT_BRIDGE_V17_PORT ||= '43991';
process.env.FRONT_BRIDGE_INTERNAL_PORT ||= '43994';
process.env.FRONT_BRIDGE_CDP_PORT ||= '43982';

// Keep the v19 CDP compatibility shim active in this process and every child
// process spawned by the v20 -> v19 -> v18 -> v17 -> v16 scanner tree.
await import('./playwright-cdp-compat.mjs');
await import('./server-v20.mjs');
