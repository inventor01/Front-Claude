const cdpCompatUrl = new URL('./playwright-cdp-compat.mjs', import.meta.url).href;
const scanFetchCompatUrl = new URL('./loopback-scan-fetch-compat.mjs', import.meta.url).href;
const preloads = [`--import=${cdpCompatUrl}`, `--import=${scanFetchCompatUrl}`];
const existing = String(process.env.NODE_OPTIONS || '').trim();
const options = existing ? existing.split(/\s+/) : [];
for (const preload of preloads) if (!options.includes(preload)) options.push(preload);
process.env.NODE_OPTIONS = options.join(' ');

process.env.FRONT_BRIDGE_V20_PORT ||= '43986';
process.env.FRONT_BRIDGE_CDP_PORT ||= '43982';
process.env.FRONT_CONTENT_DEEP_VIDEOS ||= '8';
process.env.FRONT_CONTENT_SCOUT_VIDEOS ||= '4';

await import('./playwright-cdp-compat.mjs');
await import('./loopback-scan-fetch-compat.mjs');
await import('./server-v21.mjs');
