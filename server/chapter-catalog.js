import { createHash } from 'node:crypto';
import { apiError } from './validation.js';

const API = 'https://api.mangadex.org';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[a-z]{2,3}(?:-[a-z]{2})?$/;
const TTL = 15 * 60000;
let queue = Promise.resolve();
let lastRequest = 0;
const refreshes = new WeakMap();

function client(options) {
  const now = options.now || Date.now;
  const fetchImpl = options.fetchImpl || fetch;
  const load = options.load || (async () => null);
  const save = options.save || (async () => {});
  const scope = options.cacheScope || options;
  if (!refreshes.has(scope)) refreshes.set(scope, new Map());
  const pending = refreshes.get(scope);
  async function request(path) {
    if (options.offline) throw apiError(503, 'The live chapter catalog is unavailable.');
    const cooldown = await load('chapters:v1:cooldown');
    if (cooldown?.until > now()) throw apiError(503, 'MangaDex is busy. Please try again later.');
    const run = async () => {
      const latestCooldown = await load('chapters:v1:cooldown');
      if (latestCooldown?.until > now())
        throw apiError(503, 'MangaDex is busy. Please try again later.');
      if (!options.fetchImpl) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, lastRequest + 350 - Date.now())),
        );
        lastRequest = Date.now();
      }
      const response = await fetchImpl(`${API}${path}`, {
        headers: {
          'User-Agent': 'Yoru/1.0 (+https://yoru.fwad101.chatgpt.site)',
          Accept: 'application/json',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      if ([403, 429].includes(response.status)) {
        const retry = Number(response.headers.get('Retry-After'));
        await save('chapters:v1:cooldown', {
          fetchedAt: now(),
          until:
            now() + Math.max(300000, Math.min(86400000, Number.isFinite(retry) ? retry * 1000 : 0)),
        });
      }
      if (!response.ok) throw apiError(503, 'MangaDex is unavailable. Please try again later.');
      const reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4 * 1024 * 1024) throw new Error('Chapter response too large');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (data.result !== 'ok') throw new Error('Invalid chapter response');
      return data;
    };
    if (options.fetchImpl) return run();
    const pending = queue.then(run, run);
    queue = pending.catch(() => {});
    return pending;
  }
  function cached(key, ttl, fetcher) {
    key = `chapters:v1:${createHash('sha256').update(key).digest('hex')}`;
    if (pending.has(key)) return pending.get(key);
    const result = refresh(key, ttl, fetcher).finally(() => pending.delete(key));
    pending.set(key, result);
    return result;
  }
  async function refresh(key, ttl, fetcher) {
    const saved = await load(key);
    if (saved && now() - saved.fetchedAt < ttl) return { ...saved, stale: false };
    try {
      const result = { data: await fetcher(), fetchedAt: now() };
      await save(key, result);
      return { ...result, stale: false };
    } catch (error) {
      console.warn('[yoru] Chapter catalog refresh failed:', error.message);
      if (saved && now() - saved.fetchedAt < 7 * 86400000) return { ...saved, stale: true };
      throw apiError(503, 'The chapter catalog could not be loaded. Please try again later.');
    }
  }
  return { request, cached, now };
}

async function mapping(id, options, api) {
  if (!/^mal-manga-[1-9]\d{0,8}$/.test(id || '')) throw apiError(400, 'Invalid manga ID.');
  const media = await options.media(id);
  if (!media || media.id !== id || !['MANGA', 'MANHWA'].includes(media.category) || media.isAdult)
    throw apiError(404, 'This manga is unavailable.');
  return api.cached(`mapping:${id}`, 6 * 3600000, async () => {
    const names = [
      ...new Set(
        [
          media.titleEnglish,
          typeof media.title === 'string'
            ? media.title
            : media.title?.english || media.title?.romaji,
          media.titleRomaji,
        ].filter(Boolean),
      ),
    ].slice(0, 3);
    for (const name of names) {
      const params = new URLSearchParams({
        title: name.slice(0, 200),
        limit: '100',
        'order[relevance]': 'desc',
      });
      params.append('contentRating[]', 'safe');
      params.append('contentRating[]', 'suggestive');
      const result = await api.request(`/manga?${params}`);
      if (!Array.isArray(result.data)) throw new Error('Invalid manga collection');
      const matches = result.data.filter(
        (item) =>
          UUID.test(item.id) &&
          String(item.attributes?.links?.mal) === id.slice(10) &&
          ['safe', 'suggestive'].includes(item.attributes?.contentRating),
      );
      if (matches.length > 1) return null;
      if (matches.length === 1)
        return {
          id: matches[0].id,
          languages: (matches[0].attributes.availableTranslatedLanguages || [])
            .filter((v) => LANGUAGE.test(v))
            .sort(),
        };
    }
    return null;
  });
}

export function normalizeChapter(item, mangaId, now = Date.now()) {
  const a = item?.attributes;
  if (
    !UUID.test(item?.id) ||
    !a ||
    a.isUnavailable ||
    !(item.relationships || []).some((r) => r.type === 'manga' && r.id === mangaId) ||
    [a.publishAt, a.readableAt].some(
      (date) => date && (!Number.isFinite(Date.parse(date)) || Date.parse(date) > now),
    )
  )
    return null;
  const groups = (item.relationships || [])
    .filter((r) => r.type === 'scanlation_group' && UUID.test(r.id))
    .map((r) => ({
      id: r.id,
      name: String(r.attributes?.name || 'Unnamed group').slice(0, 160),
      official: Boolean(r.attributes?.official),
    }));
  let readUrl = `https://mangadex.org/chapter/${item.id}`,
    readLabel = 'MangaDex';
  try {
    const url = new URL(a.externalUrl);
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname === 'mangaplus.shueisha.co.jp' &&
      groups.some((g) => g.official)
    ) {
      readUrl = url.href;
      readLabel = 'MANGA Plus';
    }
  } catch {
    /* External publisher links are optional. */
  }
  if (!Number(a.pages) && !a.externalUrl) return null;
  return {
    id: item.id,
    number: String(a.chapter || ''),
    title: String(a.title || '').slice(0, 500),
    volume: String(a.volume || ''),
    language: LANGUAGE.test(a.translatedLanguage) ? a.translatedLanguage : 'und',
    groups,
    pages: Math.max(0, Number(a.pages) || 0),
    publishedAt: a.publishAt || a.readableAt || null,
    external: Boolean(a.externalUrl),
    readUrl,
    readLabel,
  };
}

function filters(params) {
  const offset = Number(params.offset || 0),
    language = params.language || 'all',
    group = params.group || 'all',
    q = String(params.q || '').trim(),
    sort = params.sort || 'desc';
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 9900 ||
    (language !== 'all' && !LANGUAGE.test(language)) ||
    (group !== 'all' && !UUID.test(group)) ||
    q.length > 120 ||
    !['asc', 'desc'].includes(sort)
  )
    throw apiError(400, 'Invalid chapter filters.');
  return { offset, language, group, q, sort };
}

export async function getChapterCatalog(id, params = {}, options) {
  const f = filters(params),
    api = client(options);
  const match = await mapping(id, options, api);
  const base = {
    source: 'MangaDex',
    items: [],
    total: 0,
    offset: f.offset,
    limit: 100,
    nextOffset: null,
    languages: match.data?.languages || [],
    mangaId: match.data?.id || null,
    stale: match.stale,
  };
  if (!match.data) return { ...base, state: 'unmatched' };
  const query = new URLSearchParams({
    limit: '100',
    offset: String(f.offset),
    'includes[]': 'scanlation_group',
    'order[volume]': f.sort,
    'order[chapter]': f.sort,
    'order[publishAt]': 'desc',
    includeFutureUpdates: '0',
    includeFuturePublishAt: '0',
    includeUnavailable: '0',
  });
  query.append('contentRating[]', 'safe');
  query.append('contentRating[]', 'suggestive');
  if (f.language !== 'all') query.set('translatedLanguage[]', f.language);
  if (f.group !== 'all') query.set('groups[]', f.group);
  if (f.q) query.set(/^\d+(?:\.\d+)?$/.test(f.q) ? 'chapter' : 'title', f.q);
  const filtered = f.group !== 'all' || f.q;
  if (filtered) query.set('manga', match.data.id);
  const path = `${filtered ? '/chapter' : `/manga/${match.data.id}/feed`}?${query}`;
  const saved = await api.cached(path, TTL, async () => {
    const result = await api.request(path);
    if (!Array.isArray(result.data) || !Number.isInteger(result.total) || result.total < 0)
      throw new Error('Invalid chapter feed');
    return {
      items: result.data
        .map((item) => normalizeChapter(item, match.data.id, api.now()))
        .filter(Boolean),
      total: result.total,
    };
  });
  const next = f.offset + 100;
  return {
    ...base,
    ...saved.data,
    state: 'ready',
    fetchedAt: saved.fetchedAt,
    stale: saved.stale || match.stale,
    nextOffset: next < saved.data.total && next < 10000 ? next : null,
    capped: saved.data.total > 10000,
  };
}

export async function getCatalogChapter(id, chapterId, options) {
  if (!UUID.test(chapterId || '')) throw apiError(400, 'Invalid chapter ID.');
  const api = client(options),
    match = await mapping(id, options, api);
  if (!match.data) throw apiError(404, 'No verified chapter catalog is available for this title.');
  const saved = await api.cached(`edition:${chapterId}`, TTL, () =>
    api.request(`/chapter/${chapterId}?includes[]=scanlation_group`),
  );
  const chapter = normalizeChapter(saved.data.data, match.data.id, api.now());
  if (!chapter) throw apiError(404, 'This chapter is unavailable for this title.');
  return chapter;
}
