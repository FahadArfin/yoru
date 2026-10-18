import { createHash } from 'node:crypto';
import { mangaDexClient } from './chapter-catalog.js';
import { apiError } from './validation.js';
import { DAY_MS, localDayBounds, localDateKey } from '../shared/schedule.js';

const TTL = 15 * 60000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plain = (text) =>
  typeof text === 'string' ? text.replace(/<[^>]*>/g, '').slice(0, 300) : '';
const date = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
  Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;

export function normalizeChapterRelease(raw, category, now) {
  const a = raw?.attributes;
  const manga = raw?.relationships?.find((r) => r.type === 'manga');
  const m = manga?.attributes;
  const publishedAt = date(a?.publishAt);
  const readableAt = date(a?.readableAt);
  if (
    !UUID.test(raw?.id) ||
    !UUID.test(manga?.id) ||
    !m ||
    !a ||
    a.isUnavailable ||
    !['safe', 'suggestive'].includes(m.contentRating) ||
    m.originalLanguage !== (category === 'manhwa' ? 'ko' : 'ja') ||
    !publishedAt ||
    !/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(a.translatedLanguage || '') ||
    (!Number(a.pages) && !a.externalUrl)
  )
    return null;
  const upcoming = Date.parse(publishedAt) > now;
  // Old externally linked chapters sometimes use far-future placeholder dates.
  // Never present these, or chapters that are not yet readable, as new releases.
  if (
    (upcoming && readableAt !== publishedAt) ||
    (!upcoming && readableAt && Date.parse(readableAt) > now)
  )
    return null;
  const title = plain(
    m.title?.en || m.title?.['ja-ro'] || m.title?.['ko-ro'] || Object.values(m.title || {})[0],
  );
  if (!title) return null;
  return {
    id: raw.id,
    mangaId: manga.id,
    category,
    title,
    mediaId: /^[1-9]\d{0,8}$/.test(String(m.links?.mal || '')) ? `mal-manga-${m.links.mal}` : null,
    chapter: plain(a.chapter),
    chapterTitle: plain(a.title),
    language: a.translatedLanguage,
    publishedAt,
    status: upcoming ? 'scheduled' : 'released',
    cover: '',
    groups: (raw.relationships || [])
      .filter((r) => r.type === 'scanlation_group')
      .map((r) => plain(r.attributes?.name))
      .filter(Boolean)
      .slice(0, 3),
    providerUrl: `https://mangadex.org/chapter/${raw.id}`,
  };
}

export async function getChapterCalendar(input = {}, options = {}) {
  const {
    now = Date.now(),
    load = async () => null,
    save = async () => {},
    claim = async () => true,
  } = options;
  const category = input.category || 'manga',
    language = input.language || 'en',
    timezone = input.timezone || 'UTC';
  let today;
  try {
    today = localDateKey(now, timezone);
  } catch {
    throw apiError(400, 'Choose a valid timezone.');
  }
  const selected = input.date || today,
    offset = Number(input.offset || 0);
  if (
    !['manga', 'manhwa'].includes(category) ||
    !['en', 'all'].includes(language) ||
    !/^\d{4}-\d\d-\d\d$/.test(selected) ||
    !Number.isFinite(Date.parse(selected)) ||
    new Date(`${selected}T00:00:00Z`).toISOString().slice(0, 10) !== selected ||
    Math.abs(Date.parse(selected) - Date.parse(today)) > 21 * DAY_MS ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 9900 ||
    offset % 100
  ) {
    throw apiError(400, 'Choose a valid category, language and day near the current date.');
  }
  const { start, end } = localDayBounds(selected, timezone);
  const key = `chapter-calendar:v1:${createHash('sha256')
    .update(JSON.stringify([category, language, start, end, offset]))
    .digest('hex')}`;
  const saved = await load(key).catch(() => null);
  const response = (value, state, fetchedAt) => ({
    items: (value?.items || []).map((item) => ({
      ...item,
      status: Date.parse(item.publishedAt) > now ? 'scheduled' : 'released',
    })),
    nextOffset: value?.nextOffset ?? null,
    capped: Boolean(value?.capped),
    category,
    date: selected,
    language,
    timezone,
    offset,
    state,
    source: 'MangaDex',
    sourceUrl: 'https://mangadex.org',
    updatedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
  });
  if (saved && now - saved.fetchedAt < TTL) return response(saved.value, 'ready', saved.fetchedAt);
  const fallback = () => response(saved?.value, saved ? 'stale' : 'unavailable', saved?.fetchedAt);
  if (options.offline) return fallback();
  if (!(await claim(key, now).catch(() => false)))
    return response(saved?.value, saved ? 'stale' : 'pending', saved?.fetchedAt);
  const api = mangaDexClient({ ...options, now: () => now });
  try {
    const params = new URLSearchParams({
      limit: '100',
      offset: String(offset),
      publishAtSince: start.slice(0, 19),
      'order[publishAt]': 'asc',
      'originalLanguage[]': category === 'manhwa' ? 'ko' : 'ja',
      includeFutureUpdates: '1',
      includeUnavailable: '0',
    });
    // Omit includeFuturePublishAt: its tri-state filter would select ONLY future
    // or ONLY published chapters. We need both, bounded to this local date.
    params.append('contentRating[]', 'safe');
    params.append('contentRating[]', 'suggestive');
    params.append('includes[]', 'manga');
    params.append('includes[]', 'scanlation_group');
    if (language !== 'all') params.set('translatedLanguage[]', language);
    const result = await api.request(`/chapter?${params}`);
    if (
      !Array.isArray(result.data) ||
      !Number.isInteger(result.total) ||
      result.total < 0 ||
      result.data.length > 100
    )
      throw Error('Invalid chapter calendar');
    const dates = result.data.map((raw) => date(raw.attributes?.publishAt));
    if (dates.some((value) => !value)) throw Error('Missing release timestamps');
    const items = [
      ...new Map(
        result.data
          .map((raw) => normalizeChapterRelease(raw, category, now))
          .filter(
            (item) =>
              item &&
              item.publishedAt >= start &&
              item.publishedAt < end &&
              (language === 'all' || item.language === language),
          )
          .map((item) => [item.id, item]),
      ).values(),
    ];
    const ids = [...new Set(items.map((item) => item.mangaId))];
    if (ids.length) {
      try {
        const coverQuery = new URLSearchParams({ limit: '100', 'includes[]': 'cover_art' });
        ids.forEach((id) => coverQuery.append('ids[]', id));
        const covers = await api.request(`/manga?${coverQuery}`);
        const images = new Map(
          (covers.data || []).map((manga) => {
            const file = manga.relationships?.find((r) => r.type === 'cover_art')?.attributes
              ?.fileName;
            return [
              manga.id,
              typeof file === 'string' && /^[a-zA-Z0-9._-]+$/.test(file)
                ? `https://uploads.mangadex.org/covers/${manga.id}/${file}.256.jpg`
                : '',
            ];
          }),
        );
        items.forEach((item) => {
          item.cover = images.get(item.mangaId) || '';
        });
      } catch {
        /* A cover outage must not discard dated chapters. */
      }
    }
    const more = result.data.length === 100 && offset + 100 < result.total && dates.at(-1) < end;
    const value = {
      items,
      nextOffset: more && offset < 9900 ? offset + 100 : null,
      capped: more && offset >= 9900,
    };
    await save(key, { value, fetchedAt: now }).catch(() => {});
    return response(value, 'ready', now);
  } catch {
    return fallback();
  }
}
