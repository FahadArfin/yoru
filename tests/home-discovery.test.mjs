import test from 'node:test';
import assert from 'node:assert/strict';
import { getPopularAnime, popularityPeriod } from '../server/home-discovery.js';

const now = Date.parse('2026-10-15T12:00:00Z');
const anime = (route, premier, id = 21) => ({
  route,
  title: route,
  premier,
  year: Number(premier.slice(0, 4)),
  websites: { mal: `myanimelist.net/anime/${id}` },
  stats: { trackedCount: 123 },
});

test('a cold cache with another refresh in flight reports pending, then returns the shared result', async () => {
  let saved;
  const options = {
    now,
    token: 'private-token',
    load: async () => saved,
    claim: async () => false,
  };
  const pending = await getPopularAnime({ period: 'all' }, options);
  assert.equal(pending.state, 'pending');
  assert.deepEqual(pending.items, []);
  saved = { value: [{ id: 'mal-anime-21', title: 'One Piece' }], fetchedAt: now };
  const ready = await getPopularAnime({ period: 'all' }, options);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.items[0].title, 'One Piece');
});

test('popular release periods use the previous calendar year and month, including January rollover', () => {
  assert.deepEqual(popularityPeriod('year', now), {
    period: 'year',
    year: 2025,
    label: '2025 releases',
  });
  assert.deepEqual(popularityPeriod('month', Date.parse('2027-01-02T00:00:00Z')), {
    period: 'month',
    year: 2026,
    month: 11,
    season: 'fall',
    label: 'December 2026 releases',
  });
  assert.equal(popularityPeriod('invalid', now).period, 'all');
});

test('last month looks beyond the first popularity page and excludes other months and unknown dates', async () => {
  const calls = [];
  const result = await getPopularAnime(
    { period: 'month' },
    {
      now,
      token: 'private-token',
      fetchImpl: async (url, options) => {
        const params = new URL(url).searchParams;
        calls.push(params);
        assert.equal(options.redirect, 'manual');
        assert.equal(options.headers.Authorization, 'Bearer private-token');
        assert.equal(params.get('years'), '2026');
        assert.equal(params.get('seasons'), 'summer');
        return Response.json({
          totalAmount: 20,
          anime:
            calls.length === 1
              ? [
                  anime('july-hit', '2026-07-02T00:00:00Z'),
                  anime('unknown', '0001-01-01T00:00:00Z'),
                ]
              : [
                  anime('september-hit', '2026-09-20T00:00:00Z', 20),
                  anime('october-hit', '2026-10-01T00:00:00Z'),
                ],
        });
      },
    },
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(
    result.items.map((x) => x.title),
    ['september-hit'],
  );
  assert.equal(result.items[0].id, 'mal-anime-20');
  assert.equal(result.caption, 'September 2026 releases');
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});

test('popular caches are separate by calendar period and failed refreshes retain the matching last-good list', async () => {
  const cache = new Map();
  let calls = 0;
  const options = {
    now,
    token: 'private-token',
    load: async (key) => cache.get(key),
    save: async (key, value) => cache.set(key, value),
    fetchImpl: async () => {
      calls++;
      return Response.json({ totalAmount: 1, anime: [anime('last-year', '2025-01-01T00:00:00Z')] });
    },
  };
  const first = await getPopularAnime({ period: 'year' }, options);
  assert.equal(first.items.length, 1);
  assert.deepEqual(await getPopularAnime({ period: 'year' }, options), first);
  assert.equal(calls, 1);
  const stale = await getPopularAnime(
    { period: 'year' },
    {
      ...options,
      now: now + 7 * 3600000,
      fetchImpl: async () => {
        throw Error('private provider error');
      },
    },
  );
  assert.equal(stale.state, 'stale');
  assert.deepEqual(stale.items, first.items);
  const nextYear = await getPopularAnime(
    { period: 'year' },
    {
      ...options,
      now: Date.parse('2027-01-01T00:00:00Z'),
      fetchImpl: async () => {
        throw Error('offline');
      },
    },
  );
  assert.deepEqual(nextYear.items, []);
  assert.equal(nextYear.state, 'unavailable');
});
