import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGenreDirectory, getGenreDirectory } from '../server/genre-directory.js';

test('genre directory validates provider counts, removes explicit categories, and ranks by size', () => {
  const tags = normalizeGenreDirectory([
    { mal_id: 1, name: 'Action', count: 10 },
    { mal_id: 2, name: 'Adventure', count: 10 },
    { mal_id: 3, name: 'Romance', count: 99 },
    { mal_id: 4, name: 'Hentai', count: 1000 },
    { mal_id: 5, name: 'Erotica', count: 1000 },
    { mal_id: 6, name: 'Ecchi', count: 1000 },
    { mal_id: 7, name: 'Broken', count: -1 },
    { mal_id: 8, name: 'Unknown', count: '10' },
    null,
  ]);
  assert.deepEqual(
    tags.map((tag) => tag.name),
    ['Romance', 'Action', 'Adventure'],
  );
  assert.deepEqual(normalizeGenreDirectory(null), []);
});

test('saved taxonomy has dozens of counted tags and explicitly declares combined scope', async () => {
  process.env.CATALOG_OFFLINE = '1';
  const result = await getGenreDirectory();
  assert.equal(result.countScope, 'combined-manga');
  assert.ok(result.items.length > 60);
  assert.ok(result.items.some((tag) => tag.name === 'Villainess'));
  assert.ok(
    result.items.every((tag, index) => !index || result.items[index - 1].count >= tag.count),
  );
});

test('taxonomy refreshes once per day and retains saved counts during provider failure', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalOffline = process.env.CATALOG_OFFLINE;
  let now = originalNow() + 2 * 86400000;
  let calls = 0;
  try {
    process.env.CATALOG_OFFLINE = '0';
    Date.now = () => now;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ data: [{ mal_id: 1, name: 'Action', count: 12345 }] }));
    };
    assert.equal((await getGenreDirectory()).items[0].count, 12345);
    await getGenreDirectory();
    assert.equal(calls, 1);
    now += 2 * 86400000;
    globalThis.fetch = async () => {
      calls++;
      throw new Error('unavailable');
    };
    const stale = await getGenreDirectory();
    assert.equal(stale.stale, true);
    assert.equal(stale.items[0].count, 12345);
    await getGenreDirectory();
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    if (originalOffline === undefined) delete process.env.CATALOG_OFFLINE;
    else process.env.CATALOG_OFFLINE = originalOffline;
  }
});
