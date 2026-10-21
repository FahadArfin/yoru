import { api, readerRequest } from '../api.js';
import { canPreload, warmImage } from '../image-loading.js';
import { catalogEnabled, readingProvider } from '../../shared/catalog-preferences.js';
import { parseEditionReference, parseMediaReference } from '../../shared/media-reference.js';
import { readerSourceChoices } from './model.js';
import { selectionProjection } from '../../shared/catalog-selection.js';

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
export function requireReaderContext(context) {
  if (!context?.selectionFingerprint)
    throw new Error('Wait for the current reader selection to sync.');
  if (Number.isFinite(context.expiresAt) && context.expiresAt <= Date.now())
    throw new Error('Reader choices expired. Refresh to sync your current choices.');
  context.signal?.throwIfAborted();
  return context;
}
export const readerContextKey = (context) =>
  context
    ? JSON.stringify([
        context.owner,
        context.scope,
        context.destination,
        context.integrationMode,
        context.selectionFingerprint,
      ])
    : '';
// This permits display continuity only. Request/cache identity still uses the
// full mode and fingerprint, and pending transitions carry no request context.
export function canRetainReaderContext(previous, next, transition = null) {
  try {
    requireReaderContext(previous);
    requireReaderContext(next);
    if (
      previous.owner !== next.owner ||
      previous.scope !== next.scope ||
      previous.destination !== next.destination
    )
      return false;
    if (
      JSON.stringify(selectionProjection(previous).overrides) !==
      JSON.stringify(selectionProjection(next).overrides)
    )
      return false;
    return (
      previous.selectionFingerprint === next.selectionFingerprint ||
      (transition?.kind === 'integration' &&
        transition.previousContext?.selectionFingerprint === previous.selectionFingerprint &&
        transition.requestedMode === next.integrationMode)
    );
  } catch {
    return false;
  }
}
export function readerContextPath(path, context) {
  requireReaderContext(context);
  const url = new URL(path, 'https://yoru.invalid');
  if (url.origin !== 'https://yoru.invalid' || !url.pathname.startsWith('/api/'))
    throw new Error('Invalid reader request.');
  url.searchParams.set('destination', context.destination);
  url.searchParams.set('integration', context.integrationMode);
  url.searchParams.set('selectionFingerprint', context.selectionFingerprint);
  return url.pathname + url.search;
}
export async function readerMutation(path, body, method, context) {
  const result = await api(readerContextPath(path, context), {
    method: method || 'POST',
    body: JSON.stringify(body),
    signal: context.signal,
    ...(context.scope === null ? { credentials: 'omit' } : {}),
  });
  requireReaderContext(context);
  return result;
}
export function readerSourceAllowed(source, context) {
  if (!context) return false;
  if (source === 'local' || source?.id === 'local') return true;
  const ref = source?.sourceRef || source;
  const id = typeof ref === 'string' ? ref : ref?.id;
  const provider =
    typeof ref === 'object' ? ref?.providerKey || readingProvider(id) : readingProvider(id);
  return !!provider && catalogEnabled(provider, context.destination, context.overrides);
}
export const chapterListPath = (id, options = {}) =>
  `/api/media/${id}/chapters?${new URLSearchParams({
    source: options.source || options.sourceRef?.id || 'mangadex',
    language: options.language || 'en',
    group: options.group || 'all',
    q: options.q || '',
    sort: options.sort || 'desc',
    offset: String(options.offset || 0),
    ...(options.page != null ? { page: String(options.page) } : {}),
  })}`;
export async function chapterList(id, options, context = null, force = false) {
  requireReaderContext(context);
  if (
    options?.source === '' ||
    !readerSourceAllowed(options?.sourceRef || options?.source || 'mangadex', context)
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
  const result = await readerRequest(chapterListPath(id, options), {
    ...context,
    force,
    ttl: 30000,
  });
  requireReaderContext(context);
  return result;
}
export const readerPath = (id, chapter) => `/api/media/${id}/reader/${encodeURIComponent(chapter)}`;
export async function readingSources(id, force = false, context = null) {
  requireReaderContext(context);
  const data = await readerRequest(`/api/media/${id}/reading-sources`, {
    ...context,
    force,
    ttl: 30000,
  });
  requireReaderContext(context);
  const sources = readerSourceChoices(
    (data.sources || []).map((source) => ({ ...source, mediaId: source.mediaId || id })),
    context,
  );
  return { ...data, sources, disabled: !sources.length && data.state !== 'offline' };
}
export async function readerChapter(id, chapter, force = false, context = null) {
  requireReaderContext(context);
  const selected = typeof chapter === 'string' ? { id: chapter } : chapter;
  const parsed = parseEditionReference(selected?.id);
  if (!parsed) throw new Error('This chapter edition is unavailable.');
  const source =
    selected.sourceRef || selected.source || (parsed.kind !== 'extension' ? parsed.kind : null);
  if (
    parsed.kind !== 'extension' &&
    (typeof source === 'string' ? source : source?.id) !== parsed.kind
  )
    throw new Error('This chapter belongs to a different reading source.');
  if (!readerSourceAllowed(source, context))
    throw new Error(
      'This chapter source is disabled for this section. Choose another source or change Reader catalogs in Settings.',
    );
  const result = await readerRequest(readerPath(id, selected.id), {
    ...context,
    force,
    ttl: 60000,
  });
  requireReaderContext(context);
  if (
    result.id !== selected.id ||
    (result.mediaId && result.mediaId !== id) ||
    (parsed.kind === 'extension' &&
      selected.sourceRef &&
      result.sourceRef?.id !== selected.sourceRef.id)
  )
    throw new Error('The reading source returned a different chapter edition.');
  return {
    ...result,
    mediaId: id,
    sourceRef: result.sourceRef || selected.sourceRef,
    source: result.source || (typeof source === 'string' ? source : source?.id),
    kind: 'remote',
    group: result.group || result.groups?.map((g) => g.name).join(', ') || result.readLabel || '',
    pages: (result.pages || []).map((page) => ({
      ...page,
      url: readerContextPath(page.url, context),
    })),
  };
}
export async function warmReaderLink(href, signal, count = 2, context = null, edition = null) {
  if (!context || !canPreload() || signal?.aborted) return;
  try {
    const current = { ...context, signal };
    requireReaderContext(current);
    const url = new URL(href, location.origin);
    const match = url.pathname.match(/^(\/ara-ara)?\/read\/([^/]+)\/[^/]+$/);
    const chapter = url.searchParams.get('chapter');
    if (
      url.origin !== location.origin ||
      !match ||
      !parseMediaReference(match[2]) ||
      !parseEditionReference(chapter)
    )
      return;
    if ((match[1] ? 'ara-ara' : 'yoru') !== context.destination) return;
    let selected = edition || { id: chapter };
    if (parseEditionReference(chapter)?.kind === 'extension' && !selected.sourceRef) {
      const data = await readerRequest(`/api/media/${match[2]}`, current);
      const media = data.media || data;
      if (url.searchParams.get('source') && url.searchParams.get('source') !== media.sourceRef?.id)
        return;
      selected = { id: chapter, sourceRef: media.sourceRef };
    }
    const result = await readerChapter(match[2], selected, false, current);
    requireReaderContext(current);
    const start = Math.max(0, Number(url.searchParams.get('page') || 1) - 1);
    // Remote page responses are no-store. Warm only their metadata here; the
    // canvas loads nearby images once and retains them for this chapter.
    if (result.kind !== 'remote')
      result.pages.slice(start, start + count).forEach((page) => warmImage(page.url, signal));
  } catch {
    /* Navigation owns errors and retries. */
  }
}
