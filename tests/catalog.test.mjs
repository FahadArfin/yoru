import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CATALOG_OFFLINE = '1';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yoru-catalog-test-'));
const {
  normalizeTenrai,
  normalizeKitsu,
  parseMediaId,
  searchCatalog,
  searchSuggestions,
  getMedia,
  catalogQueryKey,
  catalogWindow,
  getCalendar,
} = await import('../server/catalog.js');
const { parseMalXml } = await import('../server/import.js');

test('search suggestions return safe matching titles with category filters and bounded payloads', async () => {
  assert.deepEqual((await searchSuggestions({ q: '!' })).items, []);
  assert.deepEqual((await searchSuggestions({ q: '!!' })).items, []);
  const result = await searchSuggestions({ q: 'attack on titan', category: 'anime' });
  assert.ok(result.items.length > 0 && result.items.length <= 12);
  assert.equal(result.items[0].title, 'Attack on Titan');
  assert.ok(
    result.items.every((item) => item.category === 'ANIME' && item.id.startsWith('mal-anime-')),
  );
  assert.equal(result.pending, false);
  assert.equal(result.providerUnavailable, true);
  assert.equal(result.items[0].description, undefined);
});

test('anime and manga MAL IDs stay distinct; invalid IDs cannot become provider URLs', () => {
  assert.deepEqual(parseMediaId('mal-anime-52991'), { kind: 'anime', malId: 52991 });
  assert.deepEqual(parseMediaId('mal-manga-52991'), { kind: 'manga', malId: 52991 });
  for (const id of [
    '52991',
    'https://example.com',
    'mal-anime-0',
    'mal-anime-1/full',
    'mal-manga--1',
  ])
    assert.equal(parseMediaId(id), null);
});

test('metadata retains actual provider values and identifies manhwa', () => {
  const item = normalizeTenrai(
    {
      mal_id: 123,
      type: 'Manhwa',
      title: 'A title',
      score: null,
      genres: [{ name: 'Fantasy' }],
      explicit_genres: [],
      streaming: [{ name: 'Bad', url: 'javascript:alert(1)' }],
      images: { jpg: { large_image_url: 'https://example.com/cover.jpg' } },
    },
    'MANGA',
  );
  assert.equal(item.type, 'MANHWA');
  assert.equal(item.id, 'mal-manga-123');
  assert.equal(item.score, null);
  assert.equal(item.chapters, null);
  assert.equal(
    item.externalLinks.some((link) => link.label === 'Bad'),
    false,
  );
});

test('Kitsu fallback uses verified MAL mapping and identifies its rating source', () => {
  const raw = {
    id: '55',
    type: 'manga',
    attributes: {
      canonicalTitle: 'Mapped title',
      subtype: 'manhwa',
      averageRating: '85.62',
      posterImage: { large: 'https://example.com/cover.jpg' },
    },
    relationships: { mappings: { data: [{ type: 'mappings', id: '8' }] } },
  };
  assert.equal(normalizeKitsu(raw, []), null);
  const item = normalizeKitsu(raw, [
    {
      type: 'mappings',
      id: '8',
      attributes: { externalSite: 'myanimelist/manga', externalId: '121496' },
    },
  ]);
  assert.equal(item.id, 'mal-manga-121496');
  assert.equal(item.type, 'MANHWA');
  assert.equal(item.source, 'Kitsu');
  assert.equal(item.score, 8.6);
});

test('seed offers immediate real anime, manga, and manhwa while completely offline', async () => {
  for (const category of ['ANIME', 'MANGA', 'MANHWA']) {
    const result = await searchCatalog({ category });
    assert.ok(result.items.length >= 6, `Expected populated ${category} seed`);
    assert.ok(result.items.every((item) => item.type === category && item.cover && item.sourceUrl));
  }
  const frieren = await getMedia('mal-anime-52991');
  assert.match(frieren.title, /Frieren/);
  const search = await searchCatalog({ search: 'Frieren' });
  assert.ok(search.items.some((item) => item.id === frieren.id));
});

test('anime type filters reach both providers, isolate caches, and constrain saved results', async () => {
  const base = { category: 'ANIME', sort: 'title' };
  assert.notEqual(catalogQueryKey(base), catalogQueryKey({ ...base, format: 'movie' }));
  assert.equal(catalogQueryKey(base), catalogQueryKey({ ...base, format: 'invalid' }));
  assert.equal(
    catalogQueryKey({ category: 'MANGA' }),
    catalogQueryKey({ category: 'MANGA', format: 'movie' }),
  );
  const offline = await searchCatalog({ category: 'ANIME', format: 'tv' });
  assert.ok(offline.items.length > 0);
  assert.ok(offline.items.every((item) => item.format.toLowerCase() === 'tv'));
  const previousFetch = globalThis.fetch;
  const urls = [];
  process.env.CATALOG_OFFLINE = '0';
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      urls.push(url);
      return Response.json({
        data: [{ mal_id: 920105, type: 'Movie', title: 'Type filter film' }],
        pagination: { items: { total: 1 } },
      });
    };
    const movies = await searchCatalog({ ...base, format: 'movie' });
    assert.equal(urls.at(-1).searchParams.get('type'), 'movie');
    assert.equal(movies.items[0].format, 'Movie');
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      urls.push(url);
      if (url.hostname === 'api.tenrai.org') return new Response('{}', { status: 503 });
      return Response.json({ data: [], meta: { count: 0 } });
    };
    await searchCatalog({ ...base, format: 'ova' });
    assert.ok(urls.some((url) => url.searchParams.get('filter[subtype]') === 'ova'));
  } finally {
    globalThis.fetch = previousFetch;
    process.env.CATALOG_OFFLINE = '1';
  }
});

test('one-shot collections isolate caches and preserve their format across providers and offline reads', async () => {
  const query = { category: 'MANGA', format: 'oneshot', sort: 'score', limit: 6 };
  assert.notEqual(catalogQueryKey(query), catalogQueryKey({ ...query, format: '' }));
  assert.equal(catalogQueryKey(query), catalogQueryKey({ ...query, format: 'One-shot' }));
  const previousFetch = globalThis.fetch;
  const urls = [];
  process.env.CATALOG_OFFLINE = '0';
  try {
    globalThis.fetch = async (input) => {
      urls.push(new URL(input));
      return Response.json({
        data: [{ mal_id: 920106, type: 'One-shot', title: 'A complete short story', score: 8.1 }],
        pagination: { items: { total: 1 } },
      });
    };
    const result = await searchCatalog(query);
    assert.equal(urls.at(-1).searchParams.get('type'), 'oneshot');
    assert.equal(result.items[0].type, 'MANGA');
    process.env.CATALOG_OFFLINE = '1';
    const saved = await searchCatalog({ ...query, limit: 7 });
    assert.deepEqual(
      saved.items.map((item) => item.id),
      ['mal-manga-920106'],
    );
    process.env.CATALOG_OFFLINE = '0';
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      urls.push(url);
      if (url.hostname === 'api.tenrai.org') return new Response('{}', { status: 503 });
      return Response.json({ data: [], meta: { count: 0 } });
    };
    await searchCatalog({ ...query, sort: 'title' });
    assert.ok(urls.some((url) => url.searchParams.get('filter[subtype]') === 'oneshot'));
  } finally {
    globalThis.fetch = previousFetch;
    process.env.CATALOG_OFFLINE = '1';
  }
});

test('MAL import preserves separate media IDs, status, progress, ratings, and favorites', () => {
  const preview =
    parseMalXml(`<?xml version="1.0"?><myanimelist><myinfo><user_name>Fahad</user_name></myinfo>
    <anime><series_animedb_id>2</series_animedb_id><series_title>Anime</series_title><my_status>Watching</my_status><my_watched_episodes>8</my_watched_episodes><my_score>9</my_score><my_favorite>1</my_favorite></anime>
    <manga><manga_mangadb_id>2</manga_mangadb_id><manga_title>Berserk</manga_title><my_status>On-Hold</my_status><my_read_chapters>30</my_read_chapters></manga></myanimelist>`);
  assert.equal(preview.total, 2);
  assert.equal(preview.username, 'Fahad');
  assert.equal(preview.items[0].mediaId, 'mal-anime-2');
  assert.equal(preview.items[1].mediaId, 'mal-manga-2');
  assert.equal(preview.items[0].score, 9);
  assert.equal(preview.items[0].favorite, true);
  assert.equal(preview.items[1].status, 'paused');
  assert.equal(preview.items[1].progress, 30);
});

test('MAL import rejects XML entities, malformed documents, and unrelated formats', () => {
  for (const xml of [
    '<!DOCTYPE test [<!ENTITY x SYSTEM "file:///etc/passwd">]><myanimelist/>',
    '<myanimelist><anime>',
    '<rss><item>Hello</item></rss>',
    '',
    '<myanimelist><anime><series_animedb_id>oops</series_animedb_id></anime></myanimelist>',
  ])
    assert.throws(() => parseMalXml(xml));
});

test('MAL import deterministically deduplicates titles and clamps invalid progress', () => {
  const preview = parseMalXml(
    '<myanimelist><anime><series_animedb_id>1</series_animedb_id><my_watched_episodes>10</my_watched_episodes></anime><anime><series_animedb_id>1</series_animedb_id><my_watched_episodes>-5</my_watched_episodes><my_status>2</my_status></anime></myanimelist>',
  );
  assert.equal(preview.duplicates, 1);
  assert.equal(preview.total, 1);
  assert.equal(preview.items[0].progress, 0);
  assert.equal(preview.items[0].status, 'completed');
});

test('catalog cache keys and provider windows distinguish filters and later pages', () => {
  assert.deepEqual(catalogWindow({ category: 'ANIME', page: 101, limit: 24 }, 'ANIME'), {
    offset: 2400,
    limit: 24,
  });
  assert.equal(
    catalogWindow({ category: 'ANIME', page: Number.MAX_SAFE_INTEGER, limit: 48 }, 'ANIME').offset,
    0,
  );
  const base = {
    category: 'MANGA',
    search: 'Hero',
    genre: 'Fantasy',
    sort: 'score',
    page: 1,
    limit: 24,
  };
  for (const change of [
    { page: 2 },
    { genre: 'Action' },
    { sort: 'newest' },
    { category: 'MANHWA' },
    { limit: 48 },
  ])
    assert.notEqual(catalogQueryKey(base), catalogQueryKey({ ...base, ...change }));
  assert.deepEqual(catalogWindow({ category: 'MANGA', page: 3, limit: 24 }, 'MANGA'), {
    offset: 48,
    limit: 24,
  });
  assert.deepEqual(catalogWindow({ page: 2, limit: 24 }, 'MANHWA'), { offset: 8, limit: 8 });
});

test('default browse waits for live totals instead of returning the starter catalog', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: [{ mal_id: 920001, title: 'Live browse title', type: 'TV', genres: [] }],
      pagination: { has_next_page: true, items: { total: 22500 } },
    });
  process.env.CATALOG_OFFLINE = '0';
  try {
    const result = await searchCatalog({ category: 'ANIME' });
    assert.equal(result.total, 22500);
    assert.equal(result.items[0].id, 'mal-anime-920001');
    assert.equal(result.pages, 938);
    assert.equal(result.catalogState, 'live');
  } finally {
    process.env.CATALOG_OFFLINE = '1';
    globalThis.fetch = previousFetch;
  }
});

test('provider failure labels a limited fallback instead of advertising a complete catalog', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  process.env.CATALOG_OFFLINE = '0';
  try {
    const result = await searchCatalog({ category: 'ANIME', search: 'Attack on Titan' });
    assert.equal(result.providerUnavailable, true);
    assert.equal(result.catalogState, 'fallback');
    assert.equal(result.source, 'offline-cache');
    assert.equal(result.totalIsEstimate, true);
  } finally {
    process.env.CATALOG_OFFLINE = '1';
    globalThis.fetch = previousFetch;
  }
});

test('curated discovery preserves featured seed order independently of ranking pages', async () => {
  const anime = await searchCatalog({ category: 'ANIME', curated: '1' });
  assert.equal(anime.items[0].id, 'mal-anime-52991');
  assert.equal(anime.items[1].id, 'mal-anime-52299');
  assert.equal(anime.items[0].bannerDimensions.width, 960);
  assert.match(anime.items[0].banner, /episode\/356901/);
  const manhwa = await searchCatalog({ category: 'MANHWA', curated: '1' });
  assert.equal(manhwa.items[0].id, 'mal-manga-121496');
  assert.equal(anime.curated, true);
});

test('remote search expands a matching seed result and fetches actual subsequent provider pages', async () => {
  const previousFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    urls.push(url);
    assert.equal(url.hostname, 'api.tenrai.org');
    assert.equal(url.pathname, '/v1/anime');
    const page = Number(url.searchParams.get('page'));
    return new Response(
      JSON.stringify({
        data: Array.from({ length: 25 }, (_, index) => ({
          mal_id: 900000 + (page - 1) * 25 + index,
          title: `Frieren remote ${(page - 1) * 25 + index}`,
          type: 'TV',
          images: { jpg: { large_image_url: 'https://example.com/poster.jpg' } },
          genres: [],
        })),
        pagination: { has_next_page: page < 3, items: { total: 60 } },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  process.env.CATALOG_OFFLINE = '0';
  try {
    const first = await searchCatalog({ category: 'ANIME', search: 'Frieren', limit: 24 });
    assert.equal(first.items[0].id, 'mal-anime-900000');
    assert.equal(first.total, 60);
    assert.equal(first.items.length, 24);
    const second = await searchCatalog({
      category: 'ANIME',
      search: 'Frieren',
      page: 2,
      limit: 24,
    });
    assert.equal(second.items[0].id, 'mal-anime-900024');
    assert.equal(second.items.at(-1).id, 'mal-anime-900047');
    assert.equal(second.pageInfo.hasNextPage, true);
    assert.ok(urls.some((url) => url.searchParams.get('page') === '2'));
    const calls = urls.length;
    await searchCatalog({ category: 'ANIME', search: 'Frieren', page: 2, limit: 24 });
    assert.equal(urls.length, calls, 'Fresh query page should reuse its exact result');
  } finally {
    process.env.CATALOG_OFFLINE = '1';
    globalThis.fetch = previousFetch;
  }
});

test('Tenrai catalog preserves category filters, safe discovery, and provider attribution', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname !== 'api.tenrai.org') return new Response('{}', { status: 503 });
    const anime = url.pathname === '/v1/anime';
    assert.ok(anime || url.pathname === '/v1/manga');
    assert.equal(url.searchParams.get('sfw'), 'true');
    assert.equal(url.searchParams.get('order_by'), 'score');
    assert.equal(url.searchParams.get('sort'), 'desc');
    const type = anime ? 'TV' : url.searchParams.get('type') === 'manhwa' ? 'Manhwa' : 'Manga';
    if (!anime) assert.ok(['manga', 'manhwa'].includes(url.searchParams.get('type')));
    return Response.json({
      data: [
        { mal_id: 980001, title: `Tenrai contract ${type}`, type, score: 8.1, genres: [] },
        {
          mal_id: 980002,
          title: `Tenrai contract excluded ${type}`,
          type,
          genres: [],
          explicit_genres: [{ mal_id: 12, name: 'Explicit' }],
        },
      ],
      pagination: { has_next_page: false, items: { total: 2 } },
    });
  };
  process.env.CATALOG_OFFLINE = '0';
  try {
    for (const category of ['ANIME', 'MANGA', 'MANHWA']) {
      const result = await searchCatalog({ category, search: 'Tenrai contract', sort: 'score' });
      assert.equal(result.catalogState, 'live');
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].category, category);
      assert.equal(result.items[0].source, 'MyAnimeList via Tenrai');
      assert.equal(result.items[0].score, 8.1);
      assert.equal(
        result.items[0].id,
        category === 'ANIME' ? 'mal-anime-980001' : 'mal-manga-980001',
      );
    }
  } finally {
    process.env.CATALOG_OFFLINE = '1';
    globalThis.fetch = previousFetch;
  }
});

test('Tenrai detail uses the correct MAL namespace and filters related content', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (input !== 'https://api.tenrai.org/v1/manga/981001/full?sfw=true')
      return new Response('{}', { status: 503 });
    return Response.json({
      data: {
        mal_id: 981001,
        title: 'Detail contract title',
        type: 'Manhwa',
        genres: [],
        explicit_genres: [],
        images: { jpg: { large_image_url: 'https://example.com/cover.jpg' } },
        chapters: 100,
      },
    });
  };
  process.env.CATALOG_OFFLINE = '0';
  try {
    const result = await getMedia('mal-manga-981001');
    assert.ok(result);
    assert.equal(result.id, 'mal-manga-981001');
    assert.equal(result.category, 'MANHWA');
    assert.equal(result.source, 'MyAnimeList via Tenrai');
    assert.equal(result.chapters, 100);
    assert.equal(result.cover, 'https://example.com/cover.jpg');
    assert.equal(result.detailed, true);
  } finally {
    process.env.CATALOG_OFFLINE = '1';
    globalThis.fetch = previousFetch;
  }
});

test('a Tenrai outage falls back to mapped Kitsu titles without relabeling their ratings', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname !== 'kitsu.io') return new Response('{}', { status: 503 });
    return Response.json({
      data: [
        {
          id: '55',
          type: 'manga',
          attributes: {
            canonicalTitle: 'Fallback contract title',
            subtype: 'manhwa',
            averageRating: '85.62',
          },
          relationships: { mappings: { data: [{ type: 'mappings', id: '8' }] } },
        },
      ],
      included: [
        {
          type: 'mappings',
          id: '8',
          attributes: { externalSite: 'myanimelist/manga', externalId: '982001' },
        },
      ],
      meta: { count: 1 },
    });
  };
  process.env.CATALOG_OFFLINE = '0';
  try {
    const result = await searchCatalog({ category: 'MANHWA', search: 'Fallback contract' });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, 'mal-manga-982001');
    assert.equal(result.items[0].source, 'Kitsu');
    assert.equal(result.items[0].score, 8.6);
  } finally {
    process.env.CATALOG_OFFLINE = '1';
    globalThis.fetch = previousFetch;
  }
});

test('calendar fetches later schedule pages and preserves successful data on provider failure', async () => {
  const previousFetch = globalThis.fetch;
  const pages = [];
  let fail = false;
  globalThis.fetch = async (input) => {
    if (fail) return new Response('{}', { status: 503 });
    const url = new URL(input);
    assert.equal(url.searchParams.get('filter'), 'monday');
    const page = Number(url.searchParams.get('page'));
    pages.push(page);
    return new Response(
      JSON.stringify({
        data: [
          {
            mal_id: 910000 + page,
            title: `Scheduled ${page}`,
            type: 'TV',
            airing: true,
            broadcast: { day: 'Mondays', time: '20:00', timezone: 'Asia/Tokyo' },
            genres: [],
          },
        ],
        pagination: { has_next_page: page < 2 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  process.env.CATALOG_OFFLINE = '0';
  try {
    const first = await getCalendar({ day: 'Monday' });
    assert.deepEqual(pages, [1, 2]);
    assert.equal(first.items.length, 2);
    assert.equal(first.complete, true);
    fail = true;
    const recovered = await getCalendar({ day: 'Monday', refresh: '1' });
    assert.equal(recovered.providerUnavailable, true);
    assert.deepEqual(
      recovered.items.map((item) => item.id),
      first.items.map((item) => item.id),
    );
    assert.equal(recovered.updatedAt, first.updatedAt);
  } finally {
    process.env.CATALOG_OFFLINE = '1';
    globalThis.fetch = previousFetch;
  }
});

test('retry refreshes a partial catalog after a category provider recovers', async () => {
  const previousFetch = globalThis.fetch;
  const previousNow = Date.now;
  let unavailable = true;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (unavailable && !url.pathname.endsWith('/anime')) return new Response('{}', { status: 503 });
    const anime = url.pathname.endsWith('/anime');
    const manhwa = url.searchParams.get('type') === 'manhwa';
    return Response.json({
      data: [
        {
          mal_id: anime ? 940001 : manhwa ? 940003 : 940002,
          title: 'Partial recovery title',
          type: anime ? 'TV' : manhwa ? 'Manhwa' : 'Manga',
          genres: [],
        },
      ],
      pagination: { has_next_page: false, items: { total: 1 } },
    });
  };
  process.env.CATALOG_OFFLINE = '0';
  try {
    const first = await searchCatalog({ search: 'Partial recovery' });
    assert.equal(first.providerUnavailable, true);
    unavailable = false;
    const recovered = await searchCatalog({ search: 'Partial recovery' });
    assert.equal(recovered.providerUnavailable, false);
    assert.equal(recovered.total, 3);
    Date.now = () => previousNow() + 7 * 60 * 60 * 1000;
    unavailable = true;
    for (let retry = 0; retry < 2; retry++) {
      const retained = await searchCatalog({ search: 'Partial recovery' });
      assert.equal(retained.total, 3, 'Repeated partial refreshes retain the complete saved page');
      assert.deepEqual(
        retained.items.map((x) => x.id),
        recovered.items.map((x) => x.id),
      );
    }
  } finally {
    Date.now = previousNow;
    process.env.CATALOG_OFFLINE = '1';
    globalThis.fetch = previousFetch;
  }
});
