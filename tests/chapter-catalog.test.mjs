import test from 'node:test';
import assert from 'node:assert/strict';
import { getChapterCatalog, getCatalogChapter } from '../server/chapter-catalog.js';

const manga = '85a12738-a597-48a6-baa1-2e4c87ab8b95';
const chapter = '556037fd-ca2e-4d00-959e-d6320cde8b31';
const group = '4f1de6a2-f0c5-4ac5-bce5-02c7dbb67deb';
const timestamp = Date.parse('2026-10-17T12:00:00Z');
const title = { id: 'mal-manga-196925', category: 'MANGA', title: 'Noro-Noro Puku-Puku' };
const md = {
  id: manga,
  attributes: {
    links: { mal: '196925' },
    contentRating: 'safe',
    availableTranslatedLanguages: ['en', 'es-la'],
  },
};
const edition = {
  id: chapter,
  attributes: {
    chapter: '1.5',
    title: 'An interlude',
    translatedLanguage: 'en',
    pages: 0,
    externalUrl: 'https://mangaplus.shueisha.co.jp/viewer/1030834',
    readableAt: '2026-10-11T12:00:00Z',
  },
  relationships: [
    { id: manga, type: 'manga' },
    { id: group, type: 'scanlation_group', attributes: { name: 'MangaPlus', official: true } },
  ],
};
function setup(handler = () => null) {
  const cache = new Map(),
    calls = [];
  const options = {
    now: () => timestamp,
    media: async () => title,
    load: async (key) => cache.get(key),
    save: async (key, value) => cache.set(key, value),
    fetchImpl: async (url, init) => {
      const u = new URL(url);
      calls.push(u);
      assert.match(init.headers['User-Agent'], /^Yoru\//);
      assert.equal(init.redirect, 'manual');
      const custom = handler(u);
      if (custom) return custom;
      return Response.json(
        u.pathname === '/manga'
          ? { result: 'ok', data: [md] }
          : u.pathname === `/chapter/${chapter}`
            ? { result: 'ok', data: edition }
            : {
                result: 'ok',
                data: [edition],
                total: 125,
                offset: Number(u.searchParams.get('offset')),
                limit: 100,
              },
      );
    },
  };
  return { options, cache, calls };
}
test('exact MAL mapping, live translation metadata and provider pagination', async () => {
  const { options, calls } = setup();
  const result = await getChapterCatalog(title.id, { language: 'en' }, options);
  assert.equal(result.mangaId, manga);
  assert.deepEqual(result.languages, ['en', 'es-la']);
  assert.equal(result.total, 125);
  assert.equal(result.nextOffset, 100);
  assert.equal(result.items[0].number, '1.5');
  assert.equal(result.items[0].title, 'An interlude');
  assert.equal(result.items[0].readLabel, 'MANGA Plus');
  assert.equal(result.items[0].groups[0].name, 'MangaPlus');
  assert.equal(calls[1].searchParams.get('translatedLanguage[]'), 'en');
  assert.equal(calls[1].searchParams.get('includeFuturePublishAt'), '0');
  assert.deepEqual(calls[1].searchParams.getAll('contentRating[]'), ['safe', 'suggestive']);
  await getChapterCatalog(title.id, { language: 'en' }, options);
  assert.equal(calls.length, 2, 'cached requests avoid provider calls');
});
test('title similarity never substitutes for an exact MAL match', async () => {
  const { options } = setup(
    (u) =>
      u.pathname === '/manga' &&
      Response.json({
        result: 'ok',
        data: [{ ...md, attributes: { ...md.attributes, links: { mal: '1' } } }],
      }),
  );
  assert.equal((await getChapterCatalog(title.id, {}, options)).state, 'unmatched');
});
test('chapter lookup rejects a different manga, future or unavailable editions', async () => {
  for (const changed of [
    { relationships: [{ type: 'manga', id: 'other' }] },
    { attributes: { ...edition.attributes, isUnavailable: true } },
    { attributes: { ...edition.attributes, readableAt: '2030-01-01T00:00:00Z' } },
  ]) {
    const { options } = setup(
      (u) =>
        u.pathname === `/chapter/${chapter}` &&
        Response.json({ result: 'ok', data: { ...edition, ...changed } }),
    );
    await assert.rejects(getCatalogChapter(title.id, chapter, options), { status: 404 });
  }
});
test('language/group/title searches are provider filters, never just the first page', async () => {
  const { options, calls } = setup();
  await getChapterCatalog(
    title.id,
    { language: 'es-la', group, q: 'interlude', offset: '100', sort: 'asc' },
    options,
  );
  assert.equal(calls[1].pathname, '/chapter');
  for (const [key, value] of Object.entries({
    manga,
    'groups[]': group,
    title: 'interlude',
    offset: '100',
    'order[chapter]': 'asc',
  }))
    assert.equal(calls[1].searchParams.get(key), value);
});
test('invalid inputs and adult/anime titles never reach MangaDex', async () => {
  const { options, calls } = setup();
  for (const params of [
    { offset: '-1' },
    { offset: '10000' },
    { language: '../../' },
    { group: 'invalid' },
    { q: 'x'.repeat(121) },
  ])
    await assert.rejects(getChapterCatalog(title.id, params, options), { status: 400 });
  await assert.rejects(getChapterCatalog('mal-anime-1', {}, options), { status: 400 });
  await assert.rejects(
    getChapterCatalog(
      title.id,
      {},
      { ...options, media: async () => ({ ...title, isAdult: true }) },
    ),
    { status: 404 },
  );
  assert.equal(calls.length, 0);
});
test('provider denial respects shared cooldown and preserves only a labeled saved feed', async () => {
  const { options, calls } = setup();
  await getChapterCatalog(title.id, {}, options);
  let time = timestamp + 16 * 60000;
  options.now = () => time;
  options.fetchImpl = async () => {
    calls.push('denied');
    return new Response('', { status: 429, headers: { 'Retry-After': '300' } });
  };
  assert.equal((await getChapterCatalog(title.id, {}, options)).stale, true);
  const count = calls.length;
  time += 1000;
  await assert.rejects(getChapterCatalog(title.id, { language: 'es-la' }, options), {
    status: 503,
  });
  assert.equal(calls.length, count);
});
