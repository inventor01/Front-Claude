function firstForwarded(value: string | null) {
  return value?.split(',')[0]?.trim() || null;
}

export function samePublicOrigin(request: Request) {
  const rawOrigin = request.headers.get('origin');
  if (!rawOrigin) return false;

  let origin: URL;
  let requestUrl: URL;
  try {
    origin = new URL(rawOrigin);
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }

  // Direct deployments/dev: the URL seen by the app already is the browser URL.
  if (origin.origin === requestUrl.origin) return true;

  // Reverse proxies such as Railway can terminate HTTPS and forward the request
  // to the app over an internal HTTP origin. In that case request.url may be an
  // internal host even though the browser correctly sent the public Origin.
  const forwardedHost = firstForwarded(request.headers.get('x-forwarded-host'));
  const host = forwardedHost || request.headers.get('host');
  if (!host) return false;

  const forwardedProto = firstForwarded(request.headers.get('x-forwarded-proto'));
  const protocol = forwardedProto || requestUrl.protocol.replace(/:$/, '');
  if (protocol !== 'http' && protocol !== 'https') return false;

  try {
    return origin.origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}
