import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnimeEpisodes, normalizeEpisodes } from '../server/anime-episodes.js';

const id = 'mal-anime-21';
const now = Date.parse('2026-10-18T12:00:00Z');
const title = { id, category: 'ANIME', status: 'Currently Airing', episodes: 1200 };
const options = { now, media: async () => title };
const response = (episodes, pages = 1) => ({
  data: episodes,
  pagination: { last_visible_page: pages, has_next_page: pages > 1 },
});
test('episode metadata preserves numbers and dates, sanitizes images and deduplicates', () => {
  const result = normalizeEpisodes(
    response([
      {
        mal_id: 2,
        title: '<b>The beginning</b>',
        aired: '2026-10-01',
        images: { jpg: { image_url: 'javascript:alert(1)' } },
      },
      { mal_id: 2, title: 'The beginning' },
      { mal_id: 0 },
      {
        mal_id: 1,
        synopsis: '<b>A new adventure.</b>',
        images: { jpg: { image_url: 'https://cdn.example/1.jpg' } },
      },
    ]),
    1,
  );
  assert.deepEqual(
    result.items.map((x) => x.number),
    [1, 2],
  );
  assert.equal(result.items[0].image, 'https://cdn.example/1.jpg');
  assert.equal(result.items[0].description, 'A new adventure.');
  assert.equal(result.items[1].description, '');
  assert.equal(result.items[1].image, null);
});
test('latest lookup reads bounded final pages and excludes future episodes and planned totals', async () => {
  const calls = [];
  const result = await getAnimeEpisodes(
    id,
    { latest: '1' },
    {
      ...options,
      request: async (_, page) => {
        calls.push(page);
        return response(
          page === 1
            ? [{ mal_id: 1, aired: '2000-01-01' }]
            : [
                { mal_id: 1180, aired: '2026-10-17' },
                { mal_id: 1181, aired: '2026-10-20' },
              ],
          12,
        );
      },
    },
  );
  assert.equal(result.latest, 1180);
  assert.deepEqual(calls, [1, 12]);
  const missing = await getAnimeEpisodes(id, { latest: '1' }, { ...options, offline: true });
  assert.equal(missing.latest, null);
  assert.equal(missing.partial, true);
});
test('unknown last-page dates and outages never claim an announced total is released', async () => {
  let calls = 0;
  const result = await getAnimeEpisodes(
    id,
    { latest: '1' },
    {
      ...options,
      request: async () => {
        calls++;
        return response([{ mal_id: 1200, aired: '2026-12-01' }], 12);
      },
    },
  );
  assert.equal(result.latest, null);
  assert.equal(calls, 4);
  const upcoming = await getAnimeEpisodes(
    id,
    { latest: '1' },
    {
      ...options,
      media: async () => ({ ...title, status: 'Not yet aired' }),
      request: async () => response([{ mal_id: 1, aired: '2026-10-17' }]),
    },
  );
  assert.equal(upcoming.latest, null);
});
test('episode pages use persistent cache and retain last-known details during provider outages', async () => {
  let saved;
  const request = async () => response([{ mal_id: 1, aired: '2026-10-17' }]);
  const first = await getAnimeEpisodes(
    id,
    {},
    { ...options, request, save: async (key, value) => (saved = { key, value }) },
  );
  assert.equal(first.partial, false);
  const second = await getAnimeEpisodes(
    id,
    {},
    {
      ...options,
      request: async () => {
        throw Error('Should use cache');
      },
      load: async () => saved.value,
    },
  );
  assert.deepEqual(second.items, first.items);
  const stale = await getAnimeEpisodes(
    id,
    {},
    {
      ...options,
      now: now + 3600000,
      request: async () => {
        throw Error('Offline');
      },
      load: async () => saved.value,
    },
  );
  assert.equal(stale.partial, true);
  assert.deepEqual(stale.items, first.items);
  const completed = await getAnimeEpisodes(
    id,
    { latest: '1' },
    {
      ...options,
      offline: true,
      media: async () => ({ ...title, status: 'Finished Airing', episodes: 12 }),
    },
  );
  assert.equal(completed.latest, 12);
});
test('episode lookup rejects reading IDs, adult titles and invalid ranges before provider access', async () => {
  for (const value of ['mal-manga-21', '21', 'mal-anime-1/extra'])
    await assert.rejects(getAnimeEpisodes(value, {}, options), { status: 400 });
  await assert.rejects(getAnimeEpisodes(id, { page: '1.5' }, options), { status: 400 });
  await assert.rejects(
    getAnimeEpisodes(id, {}, { ...options, media: async () => ({ ...title, isAdult: true }) }),
    { status: 404 },
  );
});
