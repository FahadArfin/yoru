import test from 'node:test';
import assert from 'node:assert/strict';
import { getHome, releasedEpisodes, normalizeHomeAnime } from '../server/home-core.js';

const now = Date.parse('2026-10-13T18:00:00Z');
const airing = (route, time, extras = {}) => ({
  id: route,
  route,
  title: route,
  airType: 'sub',
  episode: 2,
  airingAt: new Date(time).toISOString(),
  ...extras,
});
test('weekly picks look beyond the first six titles and retain popular airing order', async () => {
  const anime = Array.from({ length: 14 }, (_, i) => ({
    route: `weekly-${i}`,
    title: `Weekly ${i}`,
    websites: { mal: `myanimelist.net/anime/${100 + i}` },
    stats: { trackedCount: 1000 - i },
  }));
  const result = await getHome(
    {},
    {
      now,
      token: 'test',
      schedule: async () => ({
        items: anime.map((x) => airing(x.route, now - 1000)),
        state: 'ready',
      }),
      fetchImpl: async () => Response.json({ anime }),
    },
  );
  assert.equal(result.hot.length, 12);
  assert.deepEqual(
    result.hot.map((x) => x.id),
    anime.slice(0, 12).map((_, i) => `mal-anime-${100 + i}`),
  );
});
test('homepage upgrades old cached resized artwork to the original source', async () => {
  const cache = new Map([
    ['home:v1:art:21', { value: 'https://example.test/small.jpg', fetchedAt: now }],
  ]);
  const result = await getHome(
    {},
    {
      now,
      token: 'test',
      artwork: [],
      load: async (key) => cache.get(key),
      save: async (key, value) => cache.set(key, value),
      schedule: async () => ({ items: [airing('test', now - 1000)], state: 'ready' }),
      fetchImpl: async (url) =>
        Response.json(
          url.includes('kitsu.io')
            ? {
                data: [
                  {
                    attributes: { externalSite: 'myanimelist/anime', externalId: '21' },
                    relationships: { item: { data: { type: 'anime', id: '12' } } },
                  },
                ],
                included: [
                  {
                    type: 'anime',
                    id: '12',
                    attributes: {
                      coverImage: {
                        large: 'https://example.test/large.jpg',
                        original: 'https://example.test/original.jpg',
                      },
                    },
                  },
                ],
              }
            : {
                anime: [
                  { route: 'test', title: 'Test', websites: { mal: 'myanimelist.net/anime/21' } },
                ],
              },
        ),
    },
  );
  assert.equal(result.hot[0].banner, 'https://example.test/original.jpg');
  assert.equal(cache.get('home:v2:art:21').value, result.hot[0].banner);
});
test('recent releases exclude future, delayed, unknown and wrong-language episodes, newest first', () => {
  const recent = airing('recent', now - 1000);
  assert.deepEqual(
    releasedEpisodes(
      [
        airing('old', now - 9 * 86400000),
        airing('future', now + 1000),
        airing('delay', now - 1000, { delayed: true }),
        airing('dub', now - 1000, { airType: 'dub' }),
        airing('unknown', now - 1000, { episode: null }),
        airing('recent', now - 60000, { episode: 1 }),
        recent,
        airing('yesterday', now - 86400000),
      ],
      'sub',
      now,
    ).map((x) => x.route),
    ['recent', 'yesterday'],
  );
});
test('only exact provider MAL anime links become native watch targets', () => {
  const base = {
    route: 'test',
    title: 'Test',
    websites: { mal: 'myanimelist.net/anime/21/One_Piece' },
  };
  assert.equal(normalizeHomeAnime(base).id, 'mal-anime-21');
  for (const mal of [
    'myanimelist.net/manga/21',
    'https://myanimelist.net.evil.test/anime/21',
    '21',
    'https://evil.test/?id=21',
  ]) {
    assert.equal(normalizeHomeAnime({ ...base, websites: { mal } }).id, null);
  }
});
test('homepage joins current week popularity with releases, persists metadata and keeps last good data', async () => {
  const cache = new Map();
  let calls = 0,
    fail = false;
  const anime = {
    route: 'test',
    title: 'Test',
    websites: { mal: 'myanimelist.net/anime/21' },
    stats: { trackedCount: 100 },
  };
  const options = {
    now,
    token: 'secret',
    load: async (k) => cache.get(k),
    save: async (k, v) => cache.set(k, v),
    schedule: async () => ({
      items: [airing('test', now - 1000)],
      state: 'ready',
      updatedAt: new Date(now).toISOString(),
    }),
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(init.redirect, 'manual');
      if (fail) throw Error('offline');
      assert.equal(init.headers.Authorization, 'Bearer secret');
      return Response.json(url.includes('/anime?') ? { anime: [anime] } : anime);
    },
  };
  const first = await getHome({ language: 'sub' }, options);
  assert.equal(first.hot[0].id, 'mal-anime-21');
  assert.equal(first.releases[0].media.id, 'mal-anime-21');
  assert.ok(!JSON.stringify(first).includes('secret'));
  const total = calls;
  await getHome({ language: 'sub' }, options);
  assert.equal(calls, total);
  fail = true;
  const stale = await getHome({}, { ...options, now: now + 7 * 3600000 });
  assert.equal(stale.hot[0].id, 'mal-anime-21');
  assert.equal(stale.stale, true);
});
