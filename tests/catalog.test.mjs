import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CATALOG_OFFLINE = '1';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yoru-catalog-test-'));
const {
  normalizeJikan,
  normalizeKitsu,
  parseMediaId,
  searchCatalog,
  getMedia,
  catalogQueryKey,
  catalogWindow,
  getCalendar,
} = await import('../server/catalog.js');
const { parseMalXml } = await import('../server/import.js');

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
  const item = normalizeJikan(
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
    assert.equal(url.hostname, 'api.jikan.moe');
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
