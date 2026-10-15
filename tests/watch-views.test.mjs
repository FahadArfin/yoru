import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { recordWatchView, getTrendingAnime, VIEW_WINDOW } from '../server/watch-views.js';

test('weekly views deduplicate browsers, expire after seven days, and only expose aggregate counts', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0002_watch_views.sql', import.meta.url), 'utf8'));
  const db = {
    run: async (sql, ...values) => sqlite.prepare(sql).run(...values),
    all: async (sql, ...values) => sqlite.prepare(sql).all(...values),
  };
  const media = async (id) => ({ id, category: 'ANIME', title: id, cover: '/icon.svg' });
  const now = Date.parse('2026-10-15T12:00:00Z');
  try {
    const visitor = await recordWatchView('mal-anime-21', '', { db, media, now });
    await Promise.all(
      Array.from({ length: 6 }, () => recordWatchView('mal-anime-21', visitor, { db, media, now })),
    );
    const other = await recordWatchView('mal-anime-21', '', { db, media, now });
    assert.notEqual(other, visitor);
    await recordWatchView('mal-anime-20', visitor, { db, media, now });
    const trending = await getTrendingAnime({ db, media, now });
    assert.deepEqual(
      trending.items.map((x) => [x.id, x.viewers]),
      [
        ['mal-anime-21', 2],
        ['mal-anime-20', 1],
      ],
    );
    assert.equal(JSON.stringify(trending).includes(visitor), false);
    assert.equal(JSON.stringify(trending).includes('visitor_hash'), false);
    assert.deepEqual((await getTrendingAnime({ db, media, now: now + VIEW_WINDOW })).items, []);
    await recordWatchView('mal-anime-20', visitor, { db, media, now: now + VIEW_WINDOW + 1 });
    assert.equal((await db.all('SELECT * FROM watch_views')).length, 1);
    await assert.rejects(recordWatchView('mal-manga-21', visitor, { db, media, now }), {
      status: 400,
    });
    await assert.rejects(
      recordWatchView('mal-anime-9', visitor, { db, media: async () => null, now }),
      { status: 404 },
    );
    await assert.rejects(
      recordWatchView('mal-anime-9', visitor, {
        db,
        media: async (id) => ({ id, category: 'ANIME', isAdult: true }),
        now,
      }),
      { status: 404 },
    );
  } finally {
    sqlite.close();
  }
});
