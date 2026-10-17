import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { chapterStats, recordChapterOpen, rateChapter } from '../server/chapter-activity.js';

const manga = '85a12738-a597-48a6-baa1-2e4c87ab8b95';
const chapter = '556037fd-ca2e-4d00-959e-d6320cde8b31';
const mediaId = 'mal-manga-196925';
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER); INSERT INTO users VALUES('alice'),('bob');",
  );
  sqlite.exec(
    readFileSync(new URL('../drizzle/0004_chapter_activity.sql', import.meta.url), 'utf8'),
  );
  const db = Object.fromEntries(
    ['all', 'run'].map((method) => [
      method,
      (sql, ...values) => sqlite.prepare(sql)[method](...values),
    ]),
  );
  db.run(
    'INSERT INTO sessions VALUES(?,?,?),(?,?,?)',
    'alice-session',
    'alice',
    Date.now() + 60000,
    'bob-session',
    'bob',
    Date.now() + 60000,
  );
  const options = {
    db,
    userId: 'alice',
    sessionHash: 'alice-session',
    media: async () => ({ id: mediaId, title: 'Noro-Noro Puku-Puku', category: 'MANGA' }),
    fetchImpl: async (url) =>
      Response.json({
        result: 'ok',
        data:
          new URL(url).pathname === '/manga'
            ? [{ id: manga, attributes: { links: { mal: '196925' }, contentRating: 'safe' } }]
            : {
                id: chapter,
                attributes: { chapter: '2', pages: 12, translatedLanguage: 'en' },
                relationships: [{ id: manga, type: 'manga' }],
              },
      }),
  };
  return { sqlite, options };
}
test('chapter opens deduplicate concurrent revisits and store only a visitor hash', async () => {
  const { sqlite, options } = fixture();
  try {
    const first = await recordChapterOpen(mediaId, chapter, null, options);
    const counts = await Promise.all(
      Array.from({ length: 4 }, () => recordChapterOpen(mediaId, chapter, first.visitor, options)),
    );
    assert.ok(counts.every((r) => r.stats.opens === 1));
    const row = sqlite.prepare('SELECT * FROM chapter_opens').get();
    assert.notEqual(row.visitor_hash, first.visitor);
    assert.match(row.visitor_hash, /^[a-f0-9]{64}$/);
    const second = await recordChapterOpen(mediaId, chapter, null, options);
    assert.equal(second.stats.opens, 2);
  } finally {
    sqlite.close();
  }
});
test('ratings upsert per account and keep personal votes out of guest responses', async () => {
  const { sqlite, options } = fixture();
  try {
    await rateChapter(mediaId, chapter, 2, options);
    const updated = await rateChapter(mediaId, chapter, 5, options);
    assert.equal(updated.votes, 1);
    assert.equal(updated.myRating, 5);
    await rateChapter(mediaId, chapter, 3, {
      ...options,
      userId: 'bob',
      sessionHash: 'bob-session',
    });
    const guest = (await chapterStats(options.db, mediaId, [chapter]))[chapter];
    assert.deepEqual(guest, { opens: 0, votes: 2, rating: 4, myRating: null });
    assert.equal((await chapterStats(options.db, 'mal-manga-21', [chapter]))[chapter].votes, 0);
    await assert.rejects(rateChapter(mediaId, chapter, 6, options), { status: 400 });
    await assert.rejects(rateChapter(mediaId, chapter, 5, { ...options, userId: null }), {
      status: 401,
    });
  } finally {
    sqlite.close();
  }
});
test('revoking a session while provider metadata loads prevents the pending rating', async () => {
  const { sqlite, options } = fixture();
  try {
    const fetcher = options.fetchImpl;
    options.fetchImpl = async (...args) => {
      const r = await fetcher(...args);
      sqlite.exec('DELETE FROM sessions');
      return r;
    };
    await assert.rejects(rateChapter(mediaId, chapter, 5, options), { status: 401 });
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM chapter_ratings').get().count, 0);
  } finally {
    sqlite.close();
  }
});
