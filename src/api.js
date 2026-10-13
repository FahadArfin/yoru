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
export function cachedApi(path, force = false) {
  const saved = cache.get(path);
  const ttl = saved?.data?.providerUnavailable || saved?.data?.totalIsEstimate ? 10000 : 120000;
  if (!force && saved && Date.now() - saved.time < ttl) return Promise.resolve(saved.data);
  if (inflight.has(path)) return inflight.get(path);
  const request = api(path)
    .then((data) => {
      cache.set(path, { data, time: Date.now() });
      return data;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, request);
  return request;
}
export function peek(path) {
  return cache.get(path)?.data;
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
