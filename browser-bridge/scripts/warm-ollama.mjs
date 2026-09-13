#!/usr/bin/env node

const provider = String(process.env.FRONT_CONTENT_PROVIDER || 'auto').toLowerCase();
const model = String(process.env.FRONT_OLLAMA_MODEL || '').trim();
const endpoint = String(process.env.FRONT_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434/api/chat').trim();
const keepAlive = String(process.env.FRONT_OLLAMA_KEEP_ALIVE || '30m').trim();
const timeoutMs = Math.max(15000, Number(process.env.FRONT_OLLAMA_WARM_TIMEOUT_MS || 75000));

if (!model || !['auto', 'ollama'].includes(provider)) process.exit(0);

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
const started = Date.now();

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: keepAlive,
      messages: [{ role: 'user', content: 'Reply with only READY.' }],
      options: { temperature: 0, num_predict: 4 },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || response.statusText || `HTTP ${response.status}`);
  console.log(`Ollama warm: ${model} ready in ${Date.now() - started}ms · keep_alive=${keepAlive}`);
} catch (error) {
  const message = error?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : String(error?.message || error);
  console.error(`Ollama warm failed: ${message}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
