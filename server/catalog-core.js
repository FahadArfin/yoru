import {
  seed,
  persisted,
  saveCatalog,
  getRequestState,
  isOffline,
  background,
  loadSearch,
  saveSearch,
  loadMedia,
  saveMedia,
} from './catalog-storage.js';
import { titleRelevance, rankSearch, searchText } from './search-ranking.js';
const TTL = 6 * 60 * 60 * 1000;
// Tenrai v1 preserves the Jikan v4 catalog schema and MyAnimeList IDs.
const TENRAI = 'https://api.tenrai.org/v1';
const KITSU = 'https://kitsu.io/api/edge';
const categories = ['ANIME', 'MANGA', 'MANHWA'];
const cache = new Map();
const searches = new Map(persisted?.searches || []);
const failures = new Map();
const genreLists = new Map();
const MAX_PENDING = 16;
const FAILURE_TTL = 60000;
let nextRequest = 0;
for (const item of seed.items || []) cache.set(item.id, item);
for (const item of persisted?.items || []) {
  if (!item?.id || !item?.title) continue;
  const original = cache.get(item.id);
  if (!original || Date.parse(item.metadataFetchedAt) > Date.parse(original.metadataFetchedAt)) {
    const restored = { ...item };
    if (original) {
      restored.externalLinks = [
        ...new Map(
          [...(original.externalLinks || []), ...(item.externalLinks || [])].map((link) => [
            link.url,
            link,
          ]),
        ).values(),
      ];
      if (original.imageSource === 'Kitsu')
        Object.assign(restored, {
          banner: original.banner,
          bannerImage: original.bannerImage,
          imageSource: original.imageSource,
          kitsuId: original.kitsuId,
          bannerSource: original.bannerSource,
          bannerDimensions: original.bannerDimensions,
        });
    }
    cache.set(item.id, restored);
  }
}
// Older snapshots may have truncated media while retaining query ID lists.
for (const [key, result] of searches) {
  if (!Array.isArray(result?.ids) || result.ids.some((id) => !cache.has(id))) searches.delete(key);
}

function persist() {
  saveCatalog(() => ({
    version: 1,
    items: [...cache.values()],
    schedules: [...scheduleCaches],
    searches: [...searches].slice(-200),
  }));
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeTenrai(item, requestedCategory = 'ANIME', detailed = false) {
  if (!Number.isInteger(Number(item?.mal_id)) || Number(item.mal_id) <= 0) return null;
  const type =
    requestedCategory === 'ANIME' ? 'ANIME' : /manhwa/i.test(item.type || '') ? 'MANHWA' : 'MANGA';
  const kind = type === 'ANIME' ? 'anime' : 'manga';
  const cover = item.images?.webp?.large_image_url || item.images?.jpg?.large_image_url || '';
  const trailerMatch = item.trailer?.embed_url?.match(/\/embed\/([\w-]{11})/);
  const trailerId = item.trailer?.youtube_id || trailerMatch?.[1] || null;
  const banner =
    item.trailer?.images?.maximum_image_url ||
    item.trailer?.images?.large_image_url ||
    (trailerId ? `https://i.ytimg.com/vi/${trailerId}/hqdefault.jpg` : cover);
  const links = [
    ...(item.streaming || []).map((link) => ({
      label: link.name,
      url: safeUrl(link.url),
      type: 'streaming',
    })),
    ...(item.external || [])
      .filter((link) =>
        /Official|Webtoon|Manga Plus|VIZ|Tapas|Tappytoon|Lezhin|Tapas|INKR|Pocket/i.test(link.name),
      )
      .map((link) => ({
        label: link.name,
        url: safeUrl(link.url),
        type: /Official/i.test(link.name) ? 'official' : 'reading',
      })),
    {
      label: 'MyAnimeList',
      url: safeUrl(item.url) || `https://myanimelist.net/${kind}/${item.mal_id}`,
      type: 'metadata',
    },
  ].filter((link) => link.url);
  const date = item.aired || item.published;
  const total = type === 'ANIME' ? item.episodes : item.chapters;
  return {
    id: `mal-${kind}-${item.mal_id}`,
    malId: Number(item.mal_id),
    idMal: Number(item.mal_id),
    type,
    category: type,
    format: item.type || type,
    title: item.title_english || item.title || item.title_japanese || 'Untitled',
    titleEnglish: item.title_english || null,
    titleRomaji: item.title || null,
    titleNative: item.title_japanese || null,
    synonyms: item.title_synonyms || [],
    description: item.synopsis || '',
    cover,
    banner,
    coverImage: { large: cover, extraLarge: cover },
    bannerImage: banner,
    genres: [
      ...new Set(
        [...(item.genres || []), ...(item.themes || [])].map((genre) => genre.name).filter(Boolean),
      ),
    ],
    genreIds: (item.genres || []).map((genre) => genre.mal_id),
    score: Number.isFinite(item.score) ? item.score : null,
    averageScore: Number.isFinite(item.score) ? Math.round(item.score * 10) : null,
    scoredBy: item.scored_by || null,
    rank: item.rank || null,
    popularity: item.popularity || null,
    members: item.members || null,
    favorites: item.favorites || null,
    episodes: item.episodes || null,
    chapters: item.chapters || null,
    volumes: item.volumes || null,
    total: total || null,
    status: item.status || 'Unknown',
    year: item.year || date?.prop?.from?.year || null,
    season: item.season || null,
    startDate: date?.from || null,
    endDate: date?.to || null,
    duration: item.duration || null,
    rating: item.rating || null,
    isAdult: (item.explicit_genres || []).length > 0 || /Rx|Hentai/i.test(item.rating || ''),
    studios: (item.studios || []).map((studio) => studio.name),
    authors: (item.authors || []).map((author) => author.name),
    externalLinks: links,
    trailer: trailerId
      ? { id: trailerId, site: 'youtube', url: `https://www.youtube.com/watch?v=${trailerId}` }
      : null,
    broadcast: item.airing ? item.broadcast || null : null,
    airing: !!item.airing,
    relations: (item.relations || []).flatMap((relation) =>
      (relation.entry || []).map((entry) => ({
        relation: relation.relation,
        id: `mal-${entry.type}-${entry.mal_id}`,
        title: entry.name,
        type: entry.type.toUpperCase(),
      })),
    ),
    source: 'MyAnimeList via Tenrai',
    sourceUrl: `https://myanimelist.net/${kind}/${item.mal_id}`,
    metadataFetchedAt: new Date().toISOString(),
    detailed,
  };
}

export function normalizeKitsu(item, included = []) {
  const attributes = item?.attributes;
  if (!attributes || !['anime', 'manga'].includes(item.type)) return null;
  const index = new Map(included.map((resource) => [`${resource.type}:${resource.id}`, resource]));
  const related = (name) =>
    (item.relationships?.[name]?.data || [])
      .map((ref) => index.get(`${ref.type}:${ref.id}`))
      .filter(Boolean);
  const mapping = related('mappings').find(
    (resource) => resource.attributes?.externalSite === `myanimelist/${item.type}`,
  );
  const malId = Number(mapping?.attributes?.externalId);
  if (!Number.isSafeInteger(malId) || malId <= 0) return null;
  const type =
    item.type === 'anime' ? 'ANIME' : attributes.subtype === 'manhwa' ? 'MANHWA' : 'MANGA';
  const cover = attributes.posterImage?.large || attributes.posterImage?.original || '';
  const banner = attributes.coverImage?.large || attributes.coverImage?.original || cover;
  const score = Number(attributes.averageRating) || null;
  const total = type === 'ANIME' ? attributes.episodeCount : attributes.chapterCount;
  const sourceUrl = `https://kitsu.app/${item.type}/${attributes.slug || item.id}`;
  return {
    id: `mal-${item.type}-${malId}`,
    malId,
    idMal: malId,
    kitsuId: item.id,
    type,
    category: type,
    format: attributes.subtype,
    title: attributes.titles?.en_us || attributes.titles?.en || attributes.canonicalTitle,
    titleEnglish: attributes.titles?.en_us || attributes.titles?.en || null,
    titleRomaji: attributes.titles?.en_jp || attributes.titles?.en_kr || attributes.canonicalTitle,
    titleNative: attributes.titles?.ja_jp || attributes.titles?.ko_kr || null,
    synonyms: attributes.abbreviatedTitles || [],
    description: attributes.synopsis || attributes.description || '',
    cover,
    banner,
    coverImage: { large: cover, extraLarge: cover },
    bannerImage: banner,
    genres: related('categories')
      .filter((category) => !category.attributes?.nsfw)
      .map((category) => category.attributes?.title)
      .filter(Boolean)
      .slice(0, 12),
    genreIds: [],
    score: score ? Math.round(score) / 10 : null,
    averageScore: score ? Math.round(score) : null,
    scoredBy: null,
    rank: attributes.ratingRank || null,
    popularity: attributes.popularityRank || null,
    members: attributes.userCount || null,
    favorites: attributes.favoritesCount || null,
    episodes: attributes.episodeCount || null,
    chapters: attributes.chapterCount || null,
    volumes: attributes.volumeCount || null,
    total: total || null,
    status:
      {
        current: type === 'ANIME' ? 'Currently Airing' : 'Publishing',
        finished: type === 'ANIME' ? 'Finished Airing' : 'Finished',
        tba: 'To Be Announced',
        unreleased: 'Not Yet Released',
        upcoming: 'Not Yet Released',
      }[attributes.status] ||
      attributes.status ||
      'Unknown',
    year: attributes.startDate ? Number(attributes.startDate.slice(0, 4)) : null,
    season: null,
    startDate: attributes.startDate || null,
    endDate: attributes.endDate || null,
    duration: attributes.episodeLength ? `${attributes.episodeLength} min` : null,
    rating: attributes.ageRating || null,
    isAdult: attributes.nsfw === true || attributes.ageRating === 'R18',
    studios: [],
    authors: [],
    externalLinks: [
      {
        label: 'MyAnimeList',
        url: `https://myanimelist.net/${item.type}/${malId}`,
        type: 'metadata',
      },
      { label: 'Kitsu', url: sourceUrl, type: 'metadata' },
    ],
    trailer: attributes.youtubeVideoId
      ? {
          id: attributes.youtubeVideoId,
          site: 'youtube',
          url: `https://www.youtube.com/watch?v=${attributes.youtubeVideoId}`,
        }
      : null,
    broadcast: null,
    airing: type === 'ANIME' && attributes.status === 'current',
    relations: [],
    source: 'Kitsu',
    sourceUrl,
    metadataFetchedAt: new Date().toISOString(),
    detailed: true,
  };
}

async function kitsu(path) {
  if (isOffline()) throw new Error('Catalog is in offline mode');
  const response = await fetch(`${KITSU}${path}`, {
    signal: AbortSignal.timeout(7000),
    headers: { Accept: 'application/vnd.api+json' },
  });
  if (!response.ok) throw new Error(`Kitsu returned ${response.status}`);
  return response.json();
}

async function kitsuSearch(query, category, offset, limit) {
  const kind = category === 'ANIME' ? 'anime' : 'manga';
  const result = { items: [], total: 0, hasNextPage: false };
  for (let start = offset; start < offset + limit; start += 20) {
    const take = Math.min(20, offset + limit - start);
    const params = new URLSearchParams({
      'page[limit]': String(take),
      'page[offset]': String(start),
      include: 'mappings,categories',
      sort:
        { score: '-averageRating', title: 'canonicalTitle', newest: '-startDate' }[query.sort] ||
        '-userCount',
    });
    if (query.search) params.set('filter[text]', query.search);
    if (query.genre)
      params.set(
        'filter[categories]',
        { scifi: 'science-fiction', sliceoflife: 'slice-of-life' }[genreKey(query.genre)] ||
          query.genre.toLowerCase().replace(/\s+/g, '-'),
      );
    if (category === 'MANHWA') params.set('filter[subtype]', 'manhwa');
    if (category === 'MANGA') params.set('filter[subtype]', 'manga');
    if (category === 'ANIME' && query.format) params.set('filter[subtype]', query.format);
    const data = await kitsu(`/${kind}?${params}`);
    result.total = Number(data.meta?.count) || result.items.length;
    // Some Kitsu searches return their first results when an offset exceeds count.
    if (start >= result.total) {
      result.hasNextPage = false;
      break;
    }
    result.items.push(
      ...(data.data || []).map((item) => normalizeKitsu(item, data.included || [])).filter(Boolean),
    );
    result.hasNextPage = !!data.links?.next;
    if (!data.links?.next) break;
  }
  return result;
}

function mergeMedia(item) {
  if (!item || item.isAdult) return null;
  const previous = cache.get(item.id);
  const merged =
    previous?.detailed && !item.detailed
      ? {
          ...previous,
          ...item,
          detailed: true,
          externalLinks: previous.externalLinks,
          relations: previous.relations,
          trailer: item.trailer || previous.trailer,
        }
      : item;
  if (previous?.imageSource === 'Kitsu') {
    merged.imageSource = 'Kitsu';
    merged.banner = previous.banner;
    merged.bannerImage = previous.bannerImage;
    merged.kitsuId = previous.kitsuId;
    merged.bannerSource = previous.bannerSource;
    merged.bannerDimensions = previous.bannerDimensions;
  }
  if (
    previous?.externalLinks?.some((link) =>
      ['streaming', 'reading', 'official'].includes(link.type),
    )
  ) {
    merged.externalLinks = [
      ...new Map(
        [...previous.externalLinks, ...merged.externalLinks].map((link) => [link.url, link]),
      ).values(),
    ];
  }
  cache.set(item.id, merged);
  background(saveMedia(merged));
  persist();
  return merged;
}

export function rememberDiscoveredMedia(items) {
  // Discovery cards are partial metadata. Never downgrade enriched title pages.
  for (const item of items) {
    if (!cache.get(item.id)?.detailed) mergeMedia({ ...item, detailed: false });
  }
  return items;
}

export function parseMediaId(id) {
  const match = String(id || '').match(/^mal-(anime|manga)-([1-9]\d{0,8})$/);
  return match ? { kind: match[1], malId: Number(match[2]) } : null;
}

async function tenrai(path) {
  if (isOffline()) throw new Error('Catalog is in offline mode');
  const state = getRequestState();
  const queuedAt = Date.now();
  const operation = state.requestQueue.then(async () => {
    const delay = Math.max(0, nextRequest - Date.now());
    if (Date.now() + delay - queuedAt > 15000) throw new Error('The metadata queue is busy');
    nextRequest = Date.now() + delay + 1100;
    await new Promise((resolve) => setTimeout(resolve, delay));
    const response = await fetch(`${TENRAI}${path}`, {
      signal: AbortSignal.timeout(7000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      if (response.status === 429)
        nextRequest =
          Date.now() + Math.min(60000, (Number(response.headers.get('retry-after')) || 10) * 1000);
      throw new Error(`Metadata provider returned ${response.status}`);
    }
    return response.json();
  });
  state.requestQueue = operation.catch(() => {});
  return operation;
}

function uniqueRequest(key, request) {
  const { pending } = getRequestState();
  if (pending.has(key)) return pending.get(key);
  if ((failures.get(key) || 0) > Date.now())
    return Promise.reject(new Error('Metadata provider is temporarily unavailable'));
  if (pending.size >= MAX_PENDING)
    return Promise.reject(new Error('Metadata provider is busy. Please try again shortly.'));
  const promise = Promise.resolve()
    .then(request)
    .catch((error) => {
      failures.set(key, Date.now() + FAILURE_TTL);
      if (failures.size > 300) failures.delete(failures.keys().next().value);
      throw error;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

export const fetchAnimeEpisodePage = (malId, page) =>
  uniqueRequest(`anime-episodes:${malId}:${page}`, () =>
    tenrai(`/anime/${malId}/episodes?page=${page}`),
  );
export const fetchAnimeCast = (malId) =>
  uniqueRequest(`anime-cast:${malId}`, () => tenrai(`/anime/${malId}/characters`));

async function refreshDetail(id) {
  const parsed = parseMediaId(id);
  if (!parsed) return null;
  return uniqueRequest(id, async () => {
    try {
      const data = await tenrai(`/${parsed.kind}/${parsed.malId}/full?sfw=true`);
      return mergeMedia(
        normalizeTenrai(data.data, parsed.kind === 'anime' ? 'ANIME' : 'MANGA', true),
      );
    } catch {
      const params = new URLSearchParams({
        'filter[externalSite]': `myanimelist/${parsed.kind}`,
        'filter[externalId]': String(parsed.malId),
        include: 'item',
      });
      const mappings = await kitsu(`/mappings?${params}`);
      const media = mappings.included?.find((item) => item.type === parsed.kind);
      if (!media) {
        failures.set(id, Date.now() + FAILURE_TTL);
        return null;
      }
      const data = await kitsu(`/${parsed.kind}/${media.id}?include=mappings,categories`);
      return mergeMedia(normalizeKitsu(data.data, data.included));
    }
  });
}

export async function getMedia(id) {
  if (!parseMediaId(id)) return null;
  const stored = await loadMedia(id).catch(() => null);
  if (
    stored &&
    (!cache.has(id) ||
      (stored.detailed && !cache.get(id).detailed) ||
      Date.parse(stored.metadataFetchedAt) > Date.parse(cache.get(id).metadataFetchedAt || 0))
  )
    cache.set(id, stored);
  const cached = cache.get(id);
  if (cached) {
    if (
      (!cached.detailed || Date.now() - Date.parse(cached.metadataFetchedAt) > TTL) &&
      getRequestState().pending.size < 12 &&
      !isOffline()
    )
      background(refreshDetail(id));
    return cached;
  }
  try {
    return await refreshDetail(id);
  } catch {
    return null;
  }
}

export function rememberImportedMedia(entries) {
  for (const entry of entries) {
    const parsed = parseMediaId(entry.mediaId);
    if (!parsed || cache.has(entry.mediaId)) continue;
    const type = parsed.kind === 'anime' ? 'ANIME' : 'MANGA';
    cache.set(entry.mediaId, {
      id: entry.mediaId,
      malId: parsed.malId,
      idMal: parsed.malId,
      title: entry.title,
      type,
      category: type,
      format: type,
      genres: [],
      score: null,
      averageScore: null,
      cover: '',
      banner: '',
      coverImage: { large: '', extraLarge: '' },
      bannerImage: '',
      description: 'Metadata will load when the catalog provider is available.',
      episodes: type === 'ANIME' ? entry.total : null,
      chapters: type === 'MANGA' ? entry.total : null,
      total: entry.total,
      status: 'Unknown',
      year: null,
      externalLinks: [
        {
          label: 'MyAnimeList',
          url: `https://myanimelist.net/${parsed.kind}/${parsed.malId}`,
          type: 'metadata',
        },
      ],
      source: 'MyAnimeList XML import',
      sourceUrl: `https://myanimelist.net/${parsed.kind}/${parsed.malId}`,
      imported: true,
      detailed: false,
      metadataFetchedAt: null,
    });
  }
  persist();
}

function optionsFor(input = {}) {
  const query = typeof input === 'string' ? { search: input } : input;
  return {
    category: categories.includes(String(query.category || query.type).toUpperCase())
      ? String(query.category || query.type).toUpperCase()
      : null,
    search: String(query.search || query.q || '')
      .trim()
      .slice(0, 150),
    genre: String(query.genre || '')
      .trim()
      .slice(0, 60),
    ...(String(query.category || query.type).toUpperCase() === 'ANIME' &&
    ['tv', 'movie', 'ova', 'ona', 'special'].includes(String(query.format).toLowerCase())
      ? { format: String(query.format).toLowerCase() }
      : {}),
    sort: ['trending', 'popular', 'score', 'title', 'newest'].includes(query.sort)
      ? query.sort
      : 'trending',
    page:
      Number.isSafeInteger(Number(query.page)) &&
      Number.isSafeInteger(Number(query.page) * 48) &&
      Number(query.page) > 0
        ? Number(query.page)
        : 1,
    limit: Math.min(48, Math.max(1, Math.floor(Number(query.limit) || 24))),
    curated: query.curated === '1' || query.curated === true,
  };
}

function matches(item, query) {
  return (
    !item.isAdult &&
    !item.imported &&
    (!query.category || item.type === query.category) &&
    (!query.format || String(item.format).toLowerCase() === query.format) &&
    (!query.search || titleRelevance(item, query.search) >= 0) &&
    (!query.genre || item.genres.some((genre) => genreKey(genre) === genreKey(query.genre)))
  );
}

function genreKey(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace('sciencefiction', 'scifi');
}

export function catalogQueryKey(input) {
  return JSON.stringify(optionsFor(input));
}

export function catalogWindow(input, category) {
  const query = optionsFor(input);
  const index = categories.indexOf(category);
  const limit = query.category
    ? query.limit
    : Math.floor(query.limit / categories.length) +
      (index < query.limit % categories.length ? 1 : 0);
  return { offset: (query.page - 1) * limit, limit };
}

async function genreIdFor(kind, genre) {
  if (!genre) return null;
  if (!genreLists.has(kind)) {
    const data = await tenrai(`/genres/${kind}`);
    genreLists.set(kind, data.data || []);
  }
  const match = genreLists.get(kind).find((item) => genreKey(item.name) === genreKey(genre));
  if (!match) throw new Error('Genre is not available from this provider');
  return match.mal_id;
}

async function categoryPage(query, category) {
  const { offset, limit } = catalogWindow(query, category);
  if (!limit) return { items: [], total: 0, hasNextPage: false, limit };
  const kind = category === 'ANIME' ? 'anime' : 'manga';
  try {
    const genreId = await genreIdFor(kind, query.genre);
    const firstPage = Math.floor(offset / 25) + 1;
    const lastPage = Math.ceil((offset + limit) / 25);
    let total = 0;
    const items = [];
    for (let page = firstPage; page <= lastPage; page++) {
      const params = new URLSearchParams({
        sfw: 'true',
        limit: '25',
        page: String(page),
        order_by:
          { score: 'score', title: 'title', newest: 'start_date' }[query.sort] || 'popularity',
        sort: ['score', 'newest'].includes(query.sort) ? 'desc' : 'asc',
      });
      if (category !== 'ANIME') params.set('type', category.toLowerCase());
      if (category === 'ANIME' && query.format) params.set('type', query.format);
      if (query.search) params.set('q', query.search);
      if (genreId) params.set('genres', String(genreId));
      const data = await tenrai(`/${kind}?${params}`);
      items.push(...(data.data || []).map((raw) => normalizeTenrai(raw, category)).filter(Boolean));
      total = Number(data.pagination?.items?.total) || items.length;
      if (!data.pagination?.has_next_page) break;
    }
    return {
      items: items.slice(offset % 25, (offset % 25) + limit),
      total,
      hasNextPage: offset + limit < total,
      limit,
    };
  } catch {
    return { ...(await kitsuSearch(query, category, offset, limit)), limit };
  }
}

async function refreshSearch(query) {
  const key = catalogQueryKey(query);
  const previous = searches.get(key);
  if (previous && !previous.partial && Date.now() - previous.fetchedAt < TTL) return previous;
  return uniqueRequest(`search:${key}`, async () => {
    const kinds = query.category ? [query.category] : categories;
    const results = await Promise.allSettled(
      kinds.map((category) => categoryPage(query, category)),
    );
    const successful = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    if (!successful.length) throw new Error('Catalog providers are unavailable');
    const groups = successful.map((result) =>
      result.items.map(mergeMedia).filter((item) => item && matches(item, query)),
    );
    const items = [];
    for (let index = 0; groups.some((group) => index < group.length); index++)
      for (const group of groups) if (group[index]) items.push(group[index]);
    const result = {
      ids: [...new Set(items.map((item) => item.id))],
      fetchedAt: Date.now(),
      total: successful.reduce((sum, result) => sum + result.total, 0),
      hasNextPage: successful.some((result) => result.hasNextPage),
      pages: Math.max(
        1,
        ...successful.map((result) => (result.limit ? Math.ceil(result.total / result.limit) : 1)),
      ),
      partial: results.some((result) => result.status === 'rejected'),
    };
    if (result.partial && previous && (!previous.partial || previous.retainedComplete)) {
      const retained = { ...previous, partial: true, retainedComplete: true };
      searches.set(key, retained);
      return retained;
    }
    searches.set(key, result);
    if (searches.size > 200) searches.delete(searches.keys().next().value);
    await saveSearch(key, result, items).catch(() => {});
    persist();
    return result;
  });
}

async function withDeadline(promise, timeout = 12000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Metadata request timed out')), timeout);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function searchCatalog(input = {}) {
  const query = optionsFor(input);
  if (query.curated) {
    const items = seed.items
      .map((item) => cache.get(item.id) || item)
      .filter((item) => matches(item, query));
    const total = items.length;
    return {
      items: items.slice((query.page - 1) * query.limit, query.page * query.limit),
      total,
      page: query.page,
      pages: Math.max(1, Math.ceil(total / query.limit)),
      limit: query.limit,
      categories,
      source: 'MyAnimeList and Kitsu',
      updatedAt:
        items
          .map((item) => item.metadataFetchedAt)
          .filter(Boolean)
          .sort()
          .at(-1) || seed.generatedAt,
      curated: true,
      cached: true,
      providerUnavailable: false,
      pageInfo: { currentPage: query.page, hasNextPage: query.page * query.limit < total, total },
    };
  }
  let providerUnavailable = isOffline();
  const key = catalogQueryKey(query);
  let remote = searches.get(key);
  if (!remote || Date.now() - remote.fetchedAt >= TTL) {
    const stored = await loadSearch(key).catch(() => null);
    if (stored && (!remote || stored.result.fetchedAt > remote.fetchedAt)) {
      for (const item of stored.items) {
        const current = cache.get(item.id);
        if (
          !current ||
          Date.parse(item.metadataFetchedAt) > Date.parse(current.metadataFetchedAt || 0)
        )
          cache.set(item.id, item);
      }
      remote = stored.result;
      searches.set(key, remote);
      if (searches.size > 200) searches.delete(searches.keys().next().value);
    }
  }
  if (!isOffline()) {
    const fresh = remote && !remote.partial && Date.now() - remote.fetchedAt < TTL;
    if (!fresh) {
      const refresh = refreshSearch(query);
      // Retain work if the response deadline wins, including on hosted Workers.
      background(refresh);
      try {
        remote = await withDeadline(refresh);
      } catch {
        providerUnavailable = true;
      }
    }
  }
  let items = [...cache.values()].filter((item) => matches(item, query));
  items.sort((a, b) => {
    if (query.sort === 'title') return a.title.localeCompare(b.title);
    if (query.sort === 'score') return (b.score || 0) - (a.score || 0);
    if (query.sort === 'newest')
      return (Date.parse(b.startDate) || 0) - (Date.parse(a.startDate) || 0);
    return (a.popularity || Number.MAX_SAFE_INTEGER) - (b.popularity || Number.MAX_SAFE_INTEGER);
  });
  const total = remote?.total ?? items.length;
  const updatedAt = remote
    ? new Date(remote.fetchedAt).toISOString()
    : items
        .map((item) => item.metadataFetchedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || seed.generatedAt;
  const resultItems = remote
    ? remote.ids.map((id) => cache.get(id)).filter(Boolean)
    : items.slice((query.page - 1) * query.limit, query.page * query.limit);
  const hasNextPage = remote?.hasNextPage ?? query.page * query.limit < total;
  return {
    items:
      query.search && query.sort === 'trending'
        ? rankSearch(resultItems, query.search)
        : resultItems,
    total,
    page: query.page,
    pages: remote?.pages ?? Math.max(1, Math.ceil(total / query.limit)),
    limit: query.limit,
    categories,
    source: remote ? 'MyAnimeList and Kitsu' : 'offline-cache',
    catalogState: remote ? (providerUnavailable || remote.partial ? 'stale' : 'live') : 'fallback',
    totalIsEstimate: !remote,
    updatedAt,
    cached: true,
    providerUnavailable: providerUnavailable || !!remote?.partial,
    pageInfo: { currentPage: query.page, hasNextPage, total },
  };
}

export async function searchSuggestions(input = {}) {
  const query = optionsFor({ q: input.q, category: input.category, limit: 24 });
  if (searchText(query.search).length < 2) return { items: [], pending: false };
  const key = catalogQueryKey(query);
  let remote = searches.get(key);
  if (!remote || Date.now() - remote.fetchedAt >= TTL) {
    const stored = await loadSearch(key).catch(() => null);
    if (stored && (!remote || stored.result.fetchedAt > remote.fetchedAt)) {
      for (const item of stored.items) {
        const current = cache.get(item.id);
        if (
          !current ||
          Date.parse(item.metadataFetchedAt) > Date.parse(current.metadataFetchedAt || 0)
        )
          cache.set(item.id, item);
      }
      remote = stored.result;
      searches.set(key, remote);
      if (searches.size > 200) searches.delete(searches.keys().next().value);
    }
  }
  let pending = false;
  let unavailable = isOffline();
  if (!isOffline() && (!remote || remote.partial || Date.now() - remote.fetchedAt >= TTL)) {
    const refresh = refreshSearch(query);
    background(refresh);
    pending = true;
    // Saved matches appear immediately; cold queries get a short first-response budget.
    if (![...cache.values()].some((item) => matches(item, query))) {
      try {
        remote = await withDeadline(refresh, 1500);
        pending = false;
      } catch {
        unavailable = true;
      }
    }
  }
  const items = rankSearch(
    [...cache.values()].filter((item) => matches(item, query)),
    query.search,
  )
    .slice(0, 12)
    .map(
      ({
        id,
        title,
        titleEnglish,
        titleRomaji,
        category,
        type,
        format,
        year,
        score,
        episodes,
        chapters,
        cover,
        coverAlternates,
      }) => ({
        id,
        title,
        titleEnglish,
        titleRomaji,
        category: category || type,
        format,
        year,
        score,
        episodes,
        chapters,
        cover,
        coverAlternates,
      }),
    );
  return { items, pending, providerUnavailable: unavailable || !!remote?.partial };
}

const scheduleCaches = new Map(
  (persisted?.schedules || []).filter(
    (entry) => Array.isArray(entry) && Array.isArray(entry[1]?.items),
  ),
);
export async function getCalendar(input = {}) {
  const requestedDay = String(input.day || '')
    .toLowerCase()
    .replace(/s$/, '');
  const day = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ].includes(requestedDay)
    ? requestedDay
    : null;
  const key = day || 'week';
  const fallback = [...cache.values()]
    .filter(
      (item) =>
        item.airing &&
        item.broadcast?.day &&
        (!day || item.broadcast.day.toLowerCase().startsWith(day)),
    )
    .map((item) => ({
      ...item,
      day: item.broadcast.day,
      time: item.broadcast.time,
      timezone: item.broadcast.timezone || 'Asia/Tokyo',
    }));
  let schedule = scheduleCaches.get(key);
  let providerUnavailable = false;
  if (
    !isOffline() &&
    (!schedule?.updatedAt ||
      Date.now() - Date.parse(schedule.updatedAt) > TTL ||
      input.refresh === '1')
  ) {
    const refresh = uniqueRequest(`calendar:${key}`, async () => {
      const items = [];
      let complete = false;
      for (let page = 1; page <= 12; page++) {
        const params = new URLSearchParams({ sfw: 'true', limit: '25', page: String(page) });
        if (day) params.set('filter', day);
        const data = await tenrai(`/schedules?${params}`);
        items.push(
          ...(data.data || [])
            .map((raw) => mergeMedia(normalizeTenrai(raw, 'ANIME')))
            .filter(Boolean)
            .filter((item) => item.airing && item.broadcast?.day)
            .map((item) => ({
              ...item,
              day: item.broadcast.day,
              time: item.broadcast.time,
              timezone: item.broadcast.timezone || 'Asia/Tokyo',
            })),
        );
        if (!data.pagination?.has_next_page) {
          complete = true;
          break;
        }
      }
      const result = {
        items: [...new Map(items.map((item) => [item.id, item])).values()],
        updatedAt: new Date().toISOString(),
        complete,
      };
      scheduleCaches.set(key, result);
      persist();
      return result;
    });
    if (!schedule || input.refresh === '1') {
      try {
        schedule = await withDeadline(refresh);
      } catch {
        providerUnavailable = true;
      }
    } else refresh.catch(() => {});
  }
  return {
    items: schedule ? schedule.items : fallback,
    updatedAt: schedule?.updatedAt || seed.generatedAt,
    timezone: 'Asia/Tokyo',
    source: 'MyAnimeList broadcast schedule',
    stale: !schedule || Date.now() - Date.parse(schedule.updatedAt) > TTL,
    providerUnavailable,
    complete: schedule?.complete ?? false,
    day,
  };
}
