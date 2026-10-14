import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getHomeSidebar, mostViewedQuery } from '../server/home-sidebar.js';

test('upcoming caches exact anime identities and retains last good results during failure', async () => {
  const cache = new Map();
  let calls = 0,
    fail = false;
  const options = {
    now: 100000000,
    token: 'private-test-token',
    load: async (key) => cache.get(key),
    save: async (key, data) => cache.set(key, data),
    fetchImpl: async (url, init) => {
      calls++;
      assert.match(url, /airing-statuses=upcoming/);
      assert.equal(init.redirect, 'manual');
      if (fail) throw Error('offline');
      return Response.json({
        anime: [{ route: 'next', title: 'Next', websites: { mal: 'myanimelist.net/anime/99' } }],
      });
    },
    viewed: async () => [{ media_id: 'mal-anime-21', viewers: 3 }],
    media: async (id) => ({ id, title: 'One Piece' }),
  };
  const first = await getHomeSidebar(options);
  assert.equal(first.upcoming[0].id, 'mal-anime-99');
  assert.equal(first.mostViewed[0].viewers, 3);
  assert.equal(first.stale, false);
  assert.ok(!JSON.stringify(first).includes('private-test-token'));
  await getHomeSidebar(options);
  assert.equal(calls, 1);
  fail = true;
  const stale = await getHomeSidebar({ ...options, now: options.now + 7 * 3600000 });
  assert.equal(stale.upcoming[0].id, 'mal-anime-99');
  assert.equal(stale.stale, true);
});
test('most viewed counts watched anime libraries only, never planned entries or manga', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE library(media_id TEXT, progress REAL);
      INSERT INTO library VALUES ('mal-anime-21',2),('mal-anime-21',5),('mal-anime-99',1),('mal-anime-99',0),('mal-manga-21',100);`);
    const rows = db.prepare(mostViewedQuery).all();
    assert.deepEqual(
      rows.map((row) => [row.media_id, row.viewers]),
      [
        ['mal-anime-21', 2],
        ['mal-anime-99', 1],
      ],
    );
  } finally {
    db.close();
  }
});
