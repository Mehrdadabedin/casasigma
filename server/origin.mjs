/**
 * Where the links in emails point (password reset, seller dashboard).
 *
 * Never from `Host` or `X-Forwarded-Host`: a caller sets those freely, so a
 * reset mail for someone else's account could carry the real token to the
 * caller's own site ("password-reset poisoning"). In production only
 * APP_ORIGIN counts. On a developer machine the page's own `Origin` is used
 * when it is this machine (Vite serves :5173 while the API answers on :8787).
 */
export const DEV_APP_ORIGIN = 'http://localhost:5173';

export function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** APP_ORIGIN as a clean `scheme://host[:port]`, or null when unset or not http(s). */
export function configuredOrigin(env = process.env) {
  const raw = String(env.APP_ORIGIN ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** The origin for links in emails; null in production when APP_ORIGIN is missing. */
export function appOrigin(request, env = process.env) {
  const configured = configuredOrigin(env);
  if (configured) return configured;
  if (env.NODE_ENV === 'production') return null;
  const origin = request.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      if (isLoopbackHost(url.hostname)) return url.origin;
    } catch {
      // Not a URL: use the default below.
    }
  }
  return DEV_APP_ORIGIN;
}
