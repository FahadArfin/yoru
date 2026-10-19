import { cachedApi } from '../api.js';
import { canPreload, warmImage } from '../image-loading.js';
import {
  catalogEnabled,
  filterReadingSources,
  readingProvider,
} from '../../shared/catalog-preferences.js';
import { catalogDestination, loadCatalogPreferences } from './catalog-preferences.js';

export function savedReadingSource(id) {
  try {
    return localStorage.getItem(`yoru:reading-source:${id}`) || '';
  } catch {
    return '';
  }
}
export function rememberReadingSource(id, source) {
  try {
    localStorage.setItem(`yoru:reading-source:${id}`, source);
  } catch {
    /* Optional device preference. */
  }
}
export const chapterListPath = (id, options = {}) =>
  `/api/media/${id}/chapters?${new URLSearchParams({
    source: options.source || 'mangadex',
    language: options.language || 'en',
    group: options.group || 'all',
    q: options.q || '',
    sort: options.sort || 'desc',
    offset: String(options.offset || 0),
  })}`;
export async function chapterList(id, options, scope = null, force = false) {
  const overrides = await loadCatalogPreferences(scope);
  if (
    options?.source === '' ||
    !catalogEnabled(readingProvider(options?.source || 'mangadex'), catalogDestination(), overrides)
  )
    return {
      mediaId: id,
      items: [],
      languages: [],
      groups: [],
      total: 0,
      nextOffset: null,
      state: 'disabled',
    };
  const result = await cachedApi(chapterListPath(id, options), force, { scope, ttl: 30000 });
  // An unresolved session must neither cache nor display a cookie owner's personal vote.
  return scope === null
    ? {
        ...result,
        items: result.items.map((item) => ({
          ...item,
          stats: item.stats ? { ...item.stats, myRating: 0 } : item.stats,
        })),
      }
    : result;
}
export const readerPath = (id, chapter) => `/api/media/${id}/reader/${encodeURIComponent(chapter)}`;
export async function readingSources(id, force = false, scope = null) {
  const [data, overrides] = await Promise.all([
    cachedApi(`/api/media/${id}/reading-sources`, force, { ttl: 30000 }),
    loadCatalogPreferences(scope),
  ]);
  const sources = filterReadingSources(data.sources, catalogDestination(), overrides);
  const disabled = !['MangaDex', 'Weeb Central'].some((provider) =>
    catalogEnabled(provider, catalogDestination(), overrides),
  );
  return { ...data, sources, disabled };
}
export async function readerChapter(id, chapter, force = false, scope = null) {
  const overrides = await loadCatalogPreferences(scope);
  const provider = chapter.startsWith('sw-weebcentral-') ? 'Weeb Central' : 'MangaDex';
  if (!catalogEnabled(provider, catalogDestination(), overrides))
    throw new Error(
      'This chapter source is disabled for this section. Change Reader catalogs in Settings.',
    );
  return cachedApi(readerPath(id, chapter), force, { ttl: 60000 });
}
export async function warmReaderLink(href, signal, count = 2, scope = null) {
  if (!canPreload() || signal?.aborted) return;
  const url = new URL(href, location.origin);
  const match = url.pathname.match(/^\/read\/(mal-manga-\d+)\/[^/]+$/);
  const chapter = url.searchParams.get('chapter');
  if (
    url.origin !== location.origin ||
    !match ||
    !/^(?:[a-f0-9-]{36}|sw-weebcentral-\d+-\d+)$/i.test(chapter || '')
  )
    return;
  try {
    const result = await readerChapter(match[1], chapter, false, scope);
    if (signal?.aborted) return;
    const start = Math.max(0, Number(url.searchParams.get('page') || 1) - 1);
    result.pages.slice(start, start + count).forEach((page) => warmImage(page.url, signal));
  } catch {
    /* Navigation still owns errors and retries. */
  }
}
