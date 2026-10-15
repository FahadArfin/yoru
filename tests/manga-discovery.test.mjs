import test from 'node:test';
import assert from 'node:assert/strict';
import { getMangaDiscovery } from '../server/manga-discovery.js';

const now = Date.parse('2026-10-15T12:00:00Z');
const manga = (id, date, count = 10, extra = {}) => ({
  id: String(id),
  type: 'manga',
  attributes: {
    canonicalTitle: `Manga ${id}`,
    subtype: 'manga',
    startDate: date,
    status: 'current',
    userCount: count,
    posterImage: { large: 'https://media.kitsu.app/cover.jpg' },
    coverImage: { original: 'https://media.kitsu.app/original.jpg' },
    ...extra,
  },
  relationships: { mappings: { data: [{ type: 'mappings', id: String(id) }] } },
});
const payload = (items, next = false) => ({
  data: items,
  links: { next: next ? 'next' : null },
  included: items.map((x) => ({
    type: 'mappings',
    id: x.id,
    attributes: { externalSite: 'myanimelist/manga', externalId: x.id },
  })),
});

test('manhwa discovery isolates its subtype and cache from manga, including period filters', async () => {
  const cache = new Map();
  let calls = 0;
  const options = {
    now,
    load: async (key) => cache.get(key),
    save: async (key, value) => cache.set(key, value),
    fetchImpl: async (url) => {
      calls++;
      const params = new URL(url).searchParams;
      const subtype = params.get('filter[subtype]');
      return Response.json(
        payload([
          manga(10, '2026-09-01', 20, { subtype }),
          manga(11, '2026-09-01', 50, { subtype: subtype === 'manhwa' ? 'manga' : 'manhwa' }),
          manga(12, '2026-10-01', 100, { subtype }),
        ]),
      );
    },
  };
  const first = await getMangaDiscovery({ mode: 'popular', period: 'month' }, options);
  const manhwa = await getMangaDiscovery(
    { mode: 'popular', period: 'month' },
    { ...options, category: 'MANHWA' },
  );
  assert.equal(manhwa.items[0].category, 'MANHWA');
  assert.deepEqual(
    manhwa.items.map((x) => x.id),
    ['mal-manga-10'],
  );
  assert.equal(first.items[0].category, 'MANGA');
  assert.equal(calls, 2);
  assert.deepEqual(
    await getMangaDiscovery(
      { mode: 'popular', period: 'month' },
      { ...options, category: 'MANHWA' },
    ),
    manhwa,
  );
  assert.equal(calls, 2);
});

test('new manga uses publication dates, strict manga identities, and original art', async () => {
  const result = await getMangaDiscovery(
    { mode: 'new' },
    {
      now,
      fetchImpl: async (url) => {
        assert.equal(new URL(url).searchParams.get('sort'), '-startDate');
        return Response.json(
          payload([
            manga(13, '2026-10-03'),
            manga(14, '2026-11-01'),
            manga(15, '2026-10-01', 1, { nsfw: true }),
            manga(16, '2026-10-01', 1, { subtype: 'manhwa' }),
            { ...manga(17, '2026-10-01'), relationships: {} },
          ]),
        );
      },
    },
  );
  assert.deepEqual(
    result.items.map((x) => x.id),
    ['mal-manga-13'],
  );
  assert.equal(result.items[0].banner, 'https://media.kitsu.app/original.jpg');
  assert.equal(result.mode, 'new');
  assert.equal(result.state, 'ready');
});

test('monthly manga ranking scans through the whole month and sorts its exact release cohort', async () => {
  let calls = 0;
  const result = await getMangaDiscovery(
    { mode: 'popular', period: 'month' },
    {
      now,
      fetchImpl: async (url) => {
        const p = new URL(url).searchParams;
        assert.equal(p.get('filter[year]'), '2026');
        calls++;
        return Response.json(
          calls === 1
            ? payload([manga(1, '2026-10-01', 999), manga(2, '2026-09-30', 30)], true)
            : payload([manga(3, '2026-09-01', 100), manga(4, '2026-08-30', 999)], true),
        );
      },
    },
  );
  assert.equal(calls, 2);
  assert.deepEqual(
    result.items.map((x) => x.id),
    ['mal-manga-3', 'mal-manga-2'],
  );
  assert.equal(result.caption, 'September 2026 releases');
});

test('manga discovery shares a per-period cache and preserves last-good data during failures', async () => {
  const saved = new Map();
  const options = {
    now,
    load: async (key) => saved.get(key),
    save: async (key, value) => saved.set(key, value),
    fetchImpl: async () => Response.json(payload([manga(13, '2025-05-01')])),
  };
  const first = await getMangaDiscovery({ mode: 'popular', period: 'year' }, options);
  assert.equal(first.items.length, 1);
  const bad = async () => {
    throw Error('offline');
  };
  assert.deepEqual(
    await getMangaDiscovery({ mode: 'popular', period: 'year' }, { ...options, fetchImpl: bad }),
    first,
  );
  const stale = await getMangaDiscovery(
    { mode: 'popular', period: 'year' },
    { ...options, now: now + 7 * 3600000, fetchImpl: bad },
  );
  assert.equal(stale.state, 'stale');
  assert.equal(stale.items.length, 1);
  assert.equal(
    (await getMangaDiscovery({ mode: 'new' }, { ...options, claim: async () => false })).state,
    'pending',
  );
  assert.equal(
    (await getMangaDiscovery({ mode: 'new' }, { ...options, offline: true })).state,
    'unavailable',
  );
});
