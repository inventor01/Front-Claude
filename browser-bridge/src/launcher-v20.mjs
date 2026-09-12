const compatUrl = new URL('./playwright-cdp-compat.mjs', import.meta.url).href;
const preload = `--import=${compatUrl}`;
const existing = String(process.env.NODE_OPTIONS || '').trim();
if (!existing.split(/\s+/).includes(preload)) process.env.NODE_OPTIONS = [existing, preload].filter(Boolean).join(' ');

// Keep the v19 CDP compatibility shim active in this process and every child
// process spawned by the v20 -> v19 -> v18 -> v17 -> v16 scanner tree.
await import('./playwright-cdp-compat.mjs');
await import('./server-v20.mjs');
