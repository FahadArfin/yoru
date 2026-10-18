import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getCommunityThreads } from '../server/community-threads.js';
const now = Date.parse('2026-10-18T18:00:00Z');
const anime = { id: 'mal-anime-52991', category: 'ANIME', title: 'Frieren' };
const manga = { id: 'mal-manga-1', category: 'MANGA', title: 'Manga' };
const manhwa = { id: 'mal-manga-2', category: 'MANHWA', type: 'MANGA', title: 'Manhwa' };
function setup(t) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE comments (media_id TEXT, unit INTEGER, created_at TEXT)');
  t.after(() => sql.close());
  return {
    now,
    db: { all: (query, ...args) => sql.prepare(query).all(...args) },
    media: async (id) => [anime, manga, manhwa].find((x) => x.id === id),
    insert: (id, unit, date = '2026-10-17T10:00:00Z') =>
      sql.prepare('INSERT INTO comments VALUES (?,?,?)').run(id, unit, date),
  };
}
test('release threads exist before comments and merge languages with exact shared comment counts', async (t) => {
  const options = setup(t);
  options.insert(anime.id, 4);
  options.insert(anime.id, 4);
  options.insert(anime.id, 0);
  options.insert(anime.id, 2);
  options.home = async () => ({
    state: 'ready',
    releases: [
      { media: anime, episode: 4, airingAt: '2026-10-18T01:00:00Z' },
      { media: anime, episode: 4, airingAt: '2026-10-18T02:00:00Z' },
      { media: anime, episode: 5, airingAt: '2026-10-18T03:00:00Z' },
      { media: anime, episode: 6, airingAt: '2026-10-19T03:00:00Z' },
      { media: anime, episode: 7, airingAt: '2026-10-17T03:00:00Z', delayed: true },
      { media: { ...anime, id: null }, episode: 8, airingAt: '2026-10-17T03:00:00Z' },
    ],
  });
  const result = await getCommunityThreads({ category: 'anime' }, options);
  assert.deepEqual(result.items.map((x) => x.unit).sort(), [2, 4, 5]);
  assert.equal(result.items.find((x) => x.unit === 4).comments, 2);
  assert.equal(result.items.find((x) => x.unit === 5).comments, 0);
  assert.equal(result.items[0].id, `${anime.id}:5`);
});
test('chapter translations share one thread while manga/manhwa, future and fractional chapters stay separate', async (t) => {
  const options = setup(t);
  options.insert(manga.id, 3);
  options.insert(manhwa.id, 9);
  options.chapters = async () => ({
    state: 'ready',
    items: [
      {
        mediaId: manga.id,
        title: manga.title,
        chapter: '4',
        publishedAt: '2026-10-18T01:00:00Z',
        status: 'released',
      },
      {
        mediaId: manga.id,
        title: manga.title,
        chapter: '4.5',
        publishedAt: '2026-10-18T01:00:00Z',
        status: 'released',
      },
      {
        mediaId: manga.id,
        title: manga.title,
        chapter: '5',
        publishedAt: '2026-10-19T01:00:00Z',
        status: 'scheduled',
      },
      {
        mediaId: null,
        title: 'Unmapped',
        chapter: '1',
        publishedAt: '2026-10-18T01:00:00Z',
        status: 'released',
      },
    ],
  });
  const result = await getCommunityThreads({ category: 'manga' }, options);
  assert.deepEqual(result.items.map((x) => x.unit).sort(), [3, 4]);
  assert.ok(result.items.every((x) => x.mediaId === manga.id));
});
test('provider outages preserve existing conversations', async (t) => {
  const options = setup(t);
  options.insert(anime.id, 10);
  options.home = async () => {
    throw new Error('offline');
  };
  const result = await getCommunityThreads({}, options);
  assert.equal(result.releaseState, 'unavailable');
  assert.equal(result.items[0].unit, 10);
  assert.equal(result.items[0].comments, 1);
});
