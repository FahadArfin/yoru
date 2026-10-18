const cache = new Map();
const inflight = new Map();
export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}
export const send = (path, body, method = 'POST') =>
  api(path, { method, body: JSON.stringify(body) });
export function cachedApi(path, force = false, { scope = '', ttl = 120000 } = {}) {
  if (scope === null) return api(path, { signal: AbortSignal.timeout(60000) });
  const key = `${scope}\n${path}`;
  const saved = cache.get(key);
  if (
    saved?.data?.providerUnavailable ||
    saved?.data?.totalIsEstimate ||
    saved?.data?.partial ||
    saved?.data?.state === 'offline'
  )
    ttl = Math.min(ttl, 10000);
  if (!force && saved && Date.now() - saved.time < ttl) return Promise.resolve(saved.data);
  if (inflight.has(key)) return inflight.get(key);
  const request = api(path, { signal: AbortSignal.timeout(60000) })
    .then((data) => {
      // A mutation may invalidate this response while it is still on the wire.
      if (inflight.get(key) === request) {
        cache.delete(key);
        cache.set(key, { data, time: Date.now() });
        while (cache.size > 160) cache.delete(cache.keys().next().value);
      }
      return data;
    })
    .finally(() => {
      if (inflight.get(key) === request) inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}
export function peek(path, scope = '', maxAge = 120000) {
  if (scope === null) return undefined;
  const saved = cache.get(`${scope}\n${path}`);
  return saved && Date.now() - saved.time < maxAge ? saved.data : undefined;
}
export function invalidateApi(prefix) {
  for (const map of [cache, inflight])
    for (const key of map.keys())
      if (key.slice(key.indexOf('\n') + 1).startsWith(prefix)) map.delete(key);
}
export function invalidateScopedApi() {
  for (const map of [cache, inflight])
    for (const key of map.keys()) if (!key.startsWith('\n')) map.delete(key);
}
export const titleOf = (media) =>
  typeof media?.title === 'string'
    ? media.title
    : media?.title?.english || media?.title?.romaji || media?.titleEnglish || 'Untitled';
export const coverOf = (media) =>
  media?.cover || media?.coverImage?.extraLarge || media?.coverImage?.large || '/icon.svg';
export const bannerOf = (media) => media?.banner || media?.bannerImage || coverOf(media);
export const isAnime = (media) => media?.category === 'ANIME' || media?.type === 'ANIME';
export const kindOf = (media) => media?.category || media?.type || 'ANIME';
export const plainText = (value = '') =>
  String(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"');
export function ago(value) {
  const n = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  return !Number.isFinite(n) || n < 60
    ? 'just now'
    : n < 3600
      ? `${Math.floor(n / 60)}m ago`
      : n < 86400
        ? `${Math.floor(n / 3600)}h ago`
        : `${Math.floor(n / 86400)}d ago`;
}
export const scoreOf = (media) =>
  Number(media?.score || (media?.averageScore ? media.averageScore / 10 : 0));
export const itemsOf = (data) => (Array.isArray(data) ? data : data?.items || []);
export const safeLink = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};
