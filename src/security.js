import { randomToken, safeEqual } from './crypto.js';

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}

export function cookieNames(config) {
  // __Host- prefix forces Secure, Path=/ and no Domain, so subdomains cannot inject cookies.
  const p = config.secureCookies ? '__Host-' : '';
  return { session: `${p}sid`, csrf: `${p}csrf`, flash: `${p}flash` };
}

export function setCookie(res, config, name, value, { maxAge, httpOnly = true, sameSite = 'Lax' } = {}) {
  res.cookie(name, value, {
    httpOnly,
    sameSite: sameSite.toLowerCase(),
    secure: config.secureCookies,
    path: '/',
    ...(maxAge !== undefined ? { maxAge } : {}),
  });
}

export function securityHeaders(config) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(config.secureCookies ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    // same-origin: invite / reset tokens in URLs never leak to other sites.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    next();
  };
}

/**
 * Double-submit CSRF token (HttpOnly cookie + hidden form field) plus an
 * Origin check on every state-changing request.
 */
export function csrf(config) {
  const names = cookieNames(config);
  return (req, res, next) => {
    let token = req.cookies[names.csrf];
    if (!token || token.length < 32) {
      token = randomToken();
      setCookie(res, config, names.csrf, token, { sameSite: 'Strict' });
    }
    res.locals.csrf = token;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    const origin = req.get('origin');
    if (origin && origin !== config.origin) return res.status(403).send('Niepoprawne źródło żądania');
    const sent = req.body?._csrf;
    if (!sent || !safeEqual(sent, req.cookies[names.csrf] ?? '')) {
      return res.status(403).send('Sesja formularza wygasła – odśwież stronę i spróbuj ponownie.');
    }
    next();
  };
}

/** Fixed-window in-memory rate limiter (single instance deployment). */
export function createRateLimiter() {
  const hits = new Map();
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
  }, 60_000);
  timer.unref();
  return {
    /** @returns {boolean} true when the call is allowed */
    hit(key, limit, windowMs) {
      const t = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.reset < t) {
        entry = { count: 0, reset: t + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return entry.count <= limit;
    },
    reset: (key) => hits.delete(key),
  };
}
