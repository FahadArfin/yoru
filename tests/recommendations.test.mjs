import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendationQuery, relatedTitles } from '../src/recommendations.js';

test('reading recommendations rank shared genres while excluding self, duplicates, adult and wrong categories', () => {
  const media = { id: 'mal-manga-1', category: 'MANHWA', genres: ['Action', 'Fantasy'] };
  const candidate = {
    id: 'mal-manga-2',
    category: 'MANHWA',
    cover: 'https://example.com/cover.jpg',
    genres: ['Action'],
  };
  const closest = { ...candidate, id: 'mal-manga-3', genres: ['fantasy', 'Action'] };
  assert.deepEqual(
    relatedTitles(media, [
      { ...candidate, id: media.id },
      { ...candidate, id: 'anime', category: 'ANIME' },
      { ...candidate, id: 'manga', category: 'MANGA' },
      { ...candidate, id: 'adult', isAdult: true },
      { ...candidate, id: 'import', imported: true },
      { ...candidate, id: 'no-cover', cover: '' },
      candidate,
      closest,
      candidate,
    ]).map((item) => item.id),
    [closest.id, candidate.id],
  );
  const query = new URL(recommendationQuery(media), 'https://yoru.example').searchParams;
  assert.equal(query.get('category'), 'MANHWA');
  assert.equal(query.get('genre'), 'Action');
  assert.equal(
    new URL(recommendationQuery(media, false), 'https://yoru.example').searchParams.has('genre'),
    false,
  );
});
