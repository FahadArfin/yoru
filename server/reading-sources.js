import { createHash, timingSafeEqual } from 'node:crypto';
import { apiError } from './validation.js';
import { getChapterCatalog, getCatalogChapter } from './chapter-catalog.js';
import { parseMediaReference, parseEditionReference } from '../shared/media-reference.js';
import { resolveMedia, resolveReadingEdition, assertSourceEligible } from './media-resolver.js';
import { createExternalCatalogStore } from './external-catalog-store.js';
import { createExtensionGateway } from './extension-gateway.js';

const defaultContext = {
  destination: 'yoru',
  integrationMode: 'all',
  overrides: {},
  extensionsEnabled: false,
};
const readingContext = (options) => options.context || defaultContext;
const native = (id) => parseMediaReference(id)?.kind === 'extension-manga';
const deps = (options) => ({
  db: options.readerDb || options.db,
  coreMedia: options.media,
  bridge:
    options.bridge ||
    createExtensionGateway({
      ...options,
      extensionsEnabled: readingContext(options).extensionsEnabled,
    }),
});
const operationContext = (options) => ({
  signal: readingContext(options).signal,
  deadlineAt: Date.now() + 12000,
  priority: 'interactive',
});
async function storedEligible(id, options) {
  return resolveMedia(id, readingContext(options), {
    db: deps(options).db,
    coreMedia: options.media,
  });
}
async function nativeMedia(id, options) {
  return resolveMedia(id, readingContext(options), deps(options));
}
async function nativeEdition(id, chapter, options) {
  return resolveReadingEdition(id, chapter, readingContext(options), deps(options));
}
function publicEdition(id, edition, options) {
  const item = {};
  for (const key of [
    'id',
    'mediaId',
    'sourceRef',
    'upstreamRef',
    'integration',
    'volume',
    'number',
    'title',
    'language',
    'order',
    'pageCount',
    'pages',
    'native',
  ])
    if (Object.hasOwn(edition, key)) item[key] = edition[key];
  const result = internal(id, {
    ...item,
    native: true,
    source: edition.sourceRef.id,
    readLabel: 'Read chapter',
  });
  return options
    ? { ...result, readUrl: `${result.readUrl}&destination=${readingContext(options).destination}` }
    : result;
}
const choices = (media) =>
  (media.readingChoices || []).map((choice) => ({
    id: choice.sourceRef.id,
    name: choice.sourceRef.providerKey,
    native: choice.integration === 'suwayomi',
    languages: [choice.sourceRef.language],
    ...choice,
  }));
function allowedSources(sources, options) {
  return sources.filter((source) => {
    try {
      assertSourceEligible(source.sourceRef || source, readingContext(options), {
        discovery: true,
      });
      return true;
    } catch {
      return false;
    }
  });
}
function exactEdition(result, selected) {
  if (
    result?.sourceRef?.id !== selected.sourceRef.id ||
    result.upstreamRef?.upstreamKey !== selected.upstreamRef.upstreamKey ||
    JSON.stringify(result.upstreamRef?.title) !== JSON.stringify(selected.upstreamRef.title)
  )
    throw apiError(404, 'This chapter is unavailable.');
  return result;
}

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
  if (options.context) await resolveMedia(id, options.context, { coreMedia: options.media });
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
  if (options.context && payload.source)
    assertSourceEligible({ id: payload.source, integration: 'core' }, options.context);
  if (options.context && payload.chapterId)
    assertSourceEligible(
      { id: parseEditionReference(payload.chapterId)?.kind, integration: 'core' },
      options.context,
    );
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
  if (native(id)) {
    const media = await nativeMedia(id, options);
    return { sources: choices(media), state: 'ready' };
  }
  await title(id, options);
  const mapped =
    options.readerDb && options.context
      ? choices(
          await resolveMedia(id, options.context, {
            db: options.readerDb,
            coreMedia: options.media,
          }),
        ).filter((choice) => choice.integration === 'suwayomi')
      : [];
  const fallback = {
    sources: [
      ...allowedSources(
        [{ id: 'mangadex', name: 'MangaDex', native: false, languages: [] }],
        options,
      ),
      ...mapped,
    ],
    state: 'external-only',
  };
  if (!options.bridgeKey) return fallback;
  if (!(await readerBridge(options))) return { ...fallback, state: 'offline' };
  try {
    const data = await call(id, '/sources', {}, options);
    return {
      sources: [
        ...allowedSources(
          data.sources.filter((s) => ['mangadex', 'weebcentral'].includes(s.id)),
          options,
        ),
        ...mapped,
      ],
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
  if (native(id)) {
    const media = await nativeMedia(id, options);
    if (params.source && params.source !== media.sourceRef.id)
      throw apiError(404, 'This source is unavailable.');
    assertSourceEligible(media.sourceRef, readingContext(options), { discovery: true });
    const result = await deps(options).bridge.chapters(
      media.upstreamRef,
      { language: params.language, page: params.page },
      operationContext(options),
    );
    if (!Array.isArray(result.items) || result.items.length > 1000)
      throw apiError(502, 'Invalid chapter list.');
    const store = createExternalCatalogStore(deps(options).db);
    const items = [];
    for (const item of result.items)
      items.push(publicEdition(id, await store.rememberEdition(id, item), options));
    await storedEligible(id, options);
    return {
      items,
      nextPage: result.nextPage,
      hasMore: !!result.hasMore,
      total: null,
      totalIsEstimate: true,
      state: 'ready',
    };
  }
  const source = params.source || 'mangadex';
  if (!['mangadex', 'weebcentral'].includes(source)) throw apiError(400, 'Unknown reading source.');
  if (options.context) {
    await title(id, options);
    assertSourceEligible({ id: source, integration: 'core' }, options.context, { discovery: true });
  }
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
  if (native(id) || parseEditionReference(chapterId)?.kind === 'extension') {
    const selected = await nativeEdition(id, chapterId, options);
    const result = exactEdition(
      await deps(options).bridge.chapter(
        selected.upstreamRef.title,
        selected.upstreamRef,
        operationContext(options),
      ),
      selected,
    );
    const publicChapter = publicEdition(
      id,
      await createExternalCatalogStore(deps(options).db).rememberEdition(id, result),
      options,
    );
    await storedEligible(id, options);
    return publicChapter;
  }
  if (!CHAPTER.test(chapterId || '')) throw apiError(400, 'Invalid chapter ID.');
  if (options.context) {
    await title(id, options);
    assertSourceEligible(
      { id: parseEditionReference(chapterId)?.kind, integration: 'core' },
      options.context,
    );
  }
  if (!chapterId.startsWith('sw-')) return getCatalogChapter(id, chapterId, options);
  const result = await call(id, '/chapter', { chapterId }, options);
  if (result.chapter?.id !== chapterId) throw apiError(502, 'Invalid chapter.');
  return result.chapter;
}
export async function getReaderChapter(id, chapterId, options) {
  if (native(id) || parseEditionReference(chapterId)?.kind === 'extension') {
    const selected = await nativeEdition(id, chapterId, options);
    const result = await deps(options).bridge.reader(
      selected.upstreamRef.title,
      selected.upstreamRef,
      operationContext(options),
    );
    exactEdition(result.edition, selected);
    await createExternalCatalogStore(deps(options).db).rememberEdition(id, result.edition);
    await storedEligible(id, options);
    if (
      !Array.isArray(result.pages) ||
      !result.pages.length ||
      result.pages.length > 500 ||
      result.pages.some((p, i) => p !== i)
    )
      throw apiError(502, 'Invalid chapter pages.');
    return {
      ...publicEdition(id, selected, options),
      kind: 'remote',
      pages: result.pages.map((_, i) => ({
        url: `/api/media/${id}/reader/${chapterId}/page/${i}?destination=${readingContext(options).destination}`,
      })),
    };
  }
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
      url: `/api/media/${id}/reader/${encodeURIComponent(chapterId)}/page/${i}${options.context?.destination === 'ara-ara' ? '?destination=ara-ara' : ''}`,
    })),
  };
}
export async function getReaderPage(id, chapterId, page, options) {
  if (native(id) || parseEditionReference(chapterId)?.kind === 'extension') {
    if (!/^\d{1,3}$/.test(String(page)) || Number(page) >= 500)
      throw apiError(400, 'Invalid page.');
    const selected = await nativeEdition(id, chapterId, options);
    return deps(options).bridge.page(
      selected.upstreamRef.title,
      selected.upstreamRef,
      Number(page),
      operationContext(options),
    );
  }
  if (!CHAPTER.test(chapterId || '') || !/^\d{1,3}$/.test(String(page)) || Number(page) >= 500)
    throw apiError(400, 'Invalid page.');
  return call(id, '/page', { chapterId, page: Number(page) }, options, true);
}
export async function getReaderCover(id, options) {
  if (!native(id)) throw apiError(404, 'This cover is unavailable.');
  const media = await nativeMedia(id, options);
  return deps(options).bridge.cover(media.upstreamRef, operationContext(options));
}
