import { apiError } from './validation.js';

const statuses = new Set([400, 401, 403, 404, 409, 413, 422, 429, 502, 503, 504]);
const reason = (status) =>
  ({ 401: 'auth-required', 403: 'access-challenge', 404: 'removed', 429: 'rate-limited' })[
    status
  ] || (status >= 500 ? 'offline' : null);
const message = (status) =>
  ({
    400: 'Invalid reading request.',
    401: 'This reading source requires sign-in.',
    403: 'This reading source requires an access check.',
    404: 'This reading source is unavailable.',
    409: 'This reading source needs verification.',
    413: 'The reading request is too large.',
    422: 'This reading operation is unsupported.',
    429: 'This reading source is rate limited. Try again later.',
  })[status] || 'This reading source is temporarily unavailable.';

// Only delay-seconds or a canonical HTTP-date, within one day, may cross the
// public boundary. Never forward arbitrary upstream header text or body data.
export function readerRetry(raw, now = Date.now()) {
  if (typeof raw !== 'string' || !raw || raw.length > 100 || /[\r\n]/.test(raw)) return {};
  let at, retryAfter;
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isSafeInteger(seconds) || seconds > 86400) return {};
    at = now + seconds * 1000;
    retryAfter = String(seconds);
  } else {
    at = Date.parse(raw);
    if (
      !Number.isFinite(at) ||
      new Date(at).toUTCString() !== raw ||
      at < now ||
      at - now > 86400000
    )
      return {};
    retryAfter = raw;
  }
  return { retryAfter, retryAt: new Date(at).toISOString() };
}
export function readerUpstreamError(status, retryAfter, now = Date.now()) {
  const code = statuses.has(status) ? status : 503;
  return Object.assign(apiError(code, message(code)), {
    readerFailure: true,
    reason: reason(code),
    ...readerRetry(retryAfter, now),
  });
}
export function readerErrorResponse(error, now = Date.now()) {
  if (error?.readerFailure !== true || !error.expose) return null;
  const normalized = readerUpstreamError(error.status, error.retryAfter, now);
  const body = { error: normalized.message, reason: normalized.reason };
  const headers = { 'cache-control': 'no-store' };
  if (normalized.retryAfter !== undefined) {
    body.retryAfter = normalized.retryAfter;
    body.retryAt = normalized.retryAt;
    headers['retry-after'] = normalized.retryAfter;
  }
  return { status: normalized.status, body, headers };
}
export function readerErrorMiddleware(error, _req, res, next) {
  const response = readerErrorResponse(error);
  if (!response || res.headersSent) return next(error);
  return res.status(response.status).set(response.headers).json(response.body);
}
