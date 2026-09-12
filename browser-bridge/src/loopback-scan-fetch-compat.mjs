import http from 'node:http';

const MARKER = Symbol.for('front.loopback.scan.fetch.v1');
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function isLoopbackScan(url, method = 'GET') {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    return loopback && parsed.protocol === 'http:' && parsed.pathname === '/scan' && String(method || 'GET').toUpperCase() === 'POST';
  } catch {
    return false;
  }
}

function response(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-front-loopback-scan-proxy': '1',
      ...extraHeaders,
    },
  });
}

async function requestBody(input, init = {}) {
  if (init.body != null) {
    if (Buffer.isBuffer(init.body)) return init.body;
    if (typeof init.body === 'string') return Buffer.from(init.body);
    if (init.body instanceof Uint8Array) return Buffer.from(init.body);
    if (init.body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(init.body));
    throw new TypeError('Unsupported local scan request body type.');
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    const bytes = await input.clone().arrayBuffer();
    return Buffer.from(bytes);
  }
  return Buffer.alloc(0);
}

async function nativeLoopbackScan(input, init = {}) {
  const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const method = String(init.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
  if (init.headers) {
    const override = new Headers(init.headers);
    for (const [key, value] of override.entries()) headers.set(key, value);
  }
  const body = await requestBody(input, init);
  const timeoutMs = Math.max(30_000, Number(process.env.FRONT_SCAN_PROXY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = http.request({
      protocol: 'http:',
      hostname: target.hostname,
      port: target.port || 80,
      path: `${target.pathname}${target.search}`,
      method,
      headers: Object.fromEntries(headers.entries()),
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        const status = Number(res.statusCode || 500);
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) for (const item of value) responseHeaders.append(key, item);
          else if (value != null) responseHeaders.set(key, String(value));
        }
        responseHeaders.set('x-front-loopback-scan-proxy', '1');
        finish(new Response([204, 205, 304].includes(status) ? null : bytes, { status, headers: responseHeaders }));
      });
    });

    const timer = setTimeout(() => {
      req.destroy();
      finish(response(504, {
        error: 'Local deep scan exceeded the internal proxy timeout.',
        detail: `The local scan ran longer than ${Math.round(timeoutMs / 1000)} seconds. Use Stop scan before retrying.`,
      }));
    }, timeoutMs);
    timer.unref?.();

    const clear = () => clearTimeout(timer);
    req.on('close', clear);
    req.on('error', (error) => {
      clear();
      finish(response(503, {
        error: 'Local scan transport failed.',
        detail: clean(error?.message || error),
      }));
    });

    const signal = init.signal || (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null);
    if (signal) {
      const abort = () => {
        req.destroy();
        clear();
        finish(response(499, { stopped: true, error: 'Local scan request was aborted.' }));
      };
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
      req.on('close', () => signal.removeEventListener('abort', abort));
    }

    if (body.length) req.write(body);
    req.end();
  });
}

if (!globalThis[MARKER]) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async function frontFetch(input, init = {}) {
    const target = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const method = init.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET');
    if (target && isLoopbackScan(target, method)) return nativeLoopbackScan(input, init);
    return originalFetch(input, init);
  };
  globalThis[MARKER] = true;
}

export const frontLoopbackScanFetchCompatibilityEnabled = true;
export { isLoopbackScan, nativeLoopbackScan };
