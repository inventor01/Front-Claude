const compatUrl = new URL('./playwright-cdp-compat.mjs', import.meta.url).href;
const preload = `--import=${compatUrl}`;
const existing = String(process.env.NODE_OPTIONS || '').trim();
if (!existing.split(/\s+/).includes(preload)) process.env.NODE_OPTIONS = [existing, preload].filter(Boolean).join(' ');

// Patch this process too. Every child process spawned by v19 inherits NODE_OPTIONS
// and receives the same compatibility shim before it imports Playwright.
await import('./playwright-cdp-compat.mjs');
await import('./server-v19.mjs');
