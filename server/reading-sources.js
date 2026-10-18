import { createHash, timingSafeEqual } from 'node:crypto';
import { apiError } from './validation.js';
import { getChapterCatalog, getCatalogChapter } from './chapter-catalog.js';

const REGISTRATION = 'reader-bridge:v1:endpoint';
const CHAPTER =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|sw-weebcentral-[1-9]\d{0,9}-[1-9]\d{0,9})$/i;
const equal = (a, b) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
export async function registerReaderBridge(key, body, options) {
  if (
    !options.bridgeKey ||
    options.bridgeKey.length < 32 ||
    !equal(String(key || ''), options.bridgeKey)
  )
    throw apiError(401, 'Unauthorized');
  let url;
  try {
    url = new URL(body.url);
  } catch {
    throw apiError(400, 'Invalid reader address.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)
  )
    throw apiError(400, 'Invalid reader address.');
  const now = (options.now || Date.now)();
  await options.save(REGISTRATION, { url: url.origin, fetchedAt: now, expiresAt: now + 180000 });
  return { ok: true };
}
export async function readerBridge(options) {
  if (!options.bridgeKey || options.bridgeKey.length < 32 || options.offline) return null;
  if (options.bridgeUrl) return { url: options.bridgeUrl };
  const data = await options.load?.(REGISTRATION);
  return data?.expiresAt > (options.now || Date.now)() ? data : null;
}
// Expose source names only, never the host's indexed library or administration.
export async function getReaderCatalogs(options) {
  const bridge = await readerBridge(options);
  if (!bridge) throw apiError(503, 'Yoru’s reader server is offline. Try again shortly.');
  try {
    const response = await (options.fetchImpl || fetch)(`${bridge.url}/catalogs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.bridgeKey}` },
      body: '{}',
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('Unavailable');
    const data = JSON.parse((await bytes(response, 1024 ** 2)).toString());
    if (!Array.isArray(data.sources)) throw new Error('Invalid response');
    return {
      sources: data.sources
        .filter((s) => /^[1-9]\d{0,23}$/.test(s.id) && typeof s.name === 'string')
        .slice(0, 500)
        .map((s) => ({
          id: String(s.id),
          name: s.name.slice(0, 100),
          language: String(s.language || '').slice(0, 20),
        })),
    };
  } catch {
    throw apiError(503, 'Yoru’s reader server is temporarily unavailable. Try again shortly.');
  }
}
async function title(id, options) {
  if (!/^mal-manga-[1-9]\d{0,8}$/.test(id || '')) throw apiError(400, 'Invalid manga ID.');
  const media = await options.media(id);
  if (!media || media.id !== id || !['MANGA', 'MANHWA'].includes(media.category) || media.isAdult)
    throw apiError(404, 'This manga is unavailable.');
  return {
    id,
    category: media.category,
    title: media.title,
    titleEnglish: media.titleEnglish,
    titleRomaji: media.titleRomaji,
    isAdult: false,
  };
}
async function bytes(response, max) {
  if (Number(response.headers.get('content-length')) > max)
    throw apiError(502, 'Reader response too large.');
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw apiError(502, 'Reader response too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
async function call(id, path, payload, options, image = false) {
  const media = await title(id, options),
    bridge = await readerBridge(options);
  if (!bridge) throw apiError(503, 'The reading server is offline. Please try again shortly.');
  let response;
  try {
    response = await (options.fetchImpl || fetch)(`${bridge.url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.bridgeKey}` },
      body: JSON.stringify({ ...payload, media }),
      redirect: 'manual',
      signal: AbortSignal.timeout(image ? 35000 : 55000),
    });
  } catch {
    throw apiError(503, 'The reading server is temporarily unavailable.');
  }
  if (!response.ok) {
    if (response.status === 404) throw apiError(404, 'This chapter is unavailable for this title.');
    if (response.status === 409) throw apiError(409, 'This chapter opens with its publisher.');
    throw apiError(503, 'This reading source is temporarily unavailable. Try another source.');
  }
  if (image) {
    const type = response.headers.get('content-type')?.split(';')[0];
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(type))
      throw apiError(502, 'The source did not return an image.');
    return {
      body: await bytes(response, 20 * 1024 ** 2),
      type,
      cached: response.headers.get('x-yoru-cache') === 'hit',
    };
  }
  const result = JSON.parse((await bytes(response, 4 * 1024 ** 2)).toString());
  if (result.mediaId !== id) throw apiError(502, 'The reader returned a different title.');
  return result;
}
export async function getReadingSources(id, options) {
  await title(id, options);
  const fallback = {
    sources: [{ id: 'mangadex', name: 'MangaDex', native: false, languages: [] }],
    state: 'external-only',
  };
  if (!options.bridgeKey) return fallback;
  if (!(await readerBridge(options))) return { ...fallback, state: 'offline' };
  try {
    const data = await call(id, '/sources', {}, options);
    return {
      sources: data.sources.filter((s) => ['mangadex', 'weebcentral'].includes(s.id)),
      state: 'ready',
      partial: !!data.unavailable,
    };
  } catch {
    return { ...fallback, state: 'offline' };
  }
}
const internal = (id, c) => ({
  ...c,
  readUrl: c.native
    ? `/read/${id}/${/^\d+(\.\d+)?$/.test(c.number) ? c.number : '1'}?${new URLSearchParams({ chapter: c.id, language: c.language || 'en' })}`
    : c.readUrl,
});
export async function getReadingCatalog(id, params, options) {
  const source = params.source || 'mangadex';
  if (!['mangadex', 'weebcentral'].includes(source)) throw apiError(400, 'Unknown reading source.');
  if (source === 'mangadex' && (!options.bridgeKey || !(await readerBridge(options))))
    return getChapterCatalog(id, params, options);
  const data = await call(id, '/chapters', { source, filters: params }, options);
  if (
    !Array.isArray(data.items) ||
    data.items.length > 100 ||
    data.items.some((c) => !CHAPTER.test(c.id))
  )
    throw apiError(502, 'Invalid chapter list.');
  return { ...data, items: data.items.map((c) => internal(id, c)) };
}
export async function getReadingChapter(id, chapterId, options) {
  if (!CHAPTER.test(chapterId || '')) throw apiError(400, 'Invalid chapter ID.');
  if (!chapterId.startsWith('sw-')) return getCatalogChapter(id, chapterId, options);
  const result = await call(id, '/chapter', { chapterId }, options);
  if (result.chapter?.id !== chapterId) throw apiError(502, 'Invalid chapter.');
  return result.chapter;
}
export async function getReaderChapter(id, chapterId, options) {
  if (!CHAPTER.test(chapterId || '')) throw apiError(400, 'Invalid chapter ID.');
  const result = await call(id, '/reader', { chapterId }, options);
  const c = result.chapter;
  if (c?.id !== chapterId || !Array.isArray(c.pages) || !c.pages.length || c.pages.length > 500)
    throw apiError(502, 'Invalid chapter pages.');
  return {
    ...c,
    kind: 'remote',
    group: c.groups?.map((g) => g.name).join(', ') || c.readLabel,
    pages: c.pages.map((_, i) => ({
      url: `/api/media/${id}/reader/${encodeURIComponent(chapterId)}/page/${i}`,
    })),
  };
}
export async function getReaderPage(id, chapterId, page, options) {
  if (!CHAPTER.test(chapterId || '') || !/^\d{1,3}$/.test(String(page)) || Number(page) >= 500)
    throw apiError(400, 'Invalid page.');
  return call(id, '/page', { chapterId, page: Number(page) }, options, true);
}
