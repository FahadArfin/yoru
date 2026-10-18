import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendationGenre, recommendationQuery, relatedTitles } from '../src/recommendations.js';

test('reading recommendations rank shared genres while excluding self, duplicates, adult and wrong categories', () => {
  const media = { id: 'mal-manga-1', category: 'MANHWA', genres: ['Action', 'Fantasy'] };
  const candidate = {
    id: 'mal-manga-2',
    category: 'MANHWA',
    cover: 'https://example.com/cover.jpg',
    genres: ['Fantasy'],
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
  assert.equal(query.get('genre'), 'Fantasy');
});

test('romance recommendations require romance and rank similar tone above incidental overlap', () => {
  const media = { id: 'romance', category: 'MANGA', genres: ['Drama', 'Romance', 'School'] };
  const item = (id, genres) => ({
    id,
    category: 'MANGA',
    genres,
    cover: 'https://example.com/cover.jpg',
  });
  const pool = [
    item('berserk', ['Action', 'Adventure', 'Drama', 'Fantasy', 'Horror']),
    item('attack-on-titan', ['Action', 'Drama', 'Suspense']),
    item('dark-romance', ['Romance', 'Horror', 'Gore', 'Psychological']),
    item('school-romance', ['Romance', 'School', 'Drama']),
    item('romantic-comedy', ['Romance', 'Comedy']),
    item('unknown', []),
  ];
  assert.equal(recommendationGenre(media), 'Romance');
  assert.deepEqual(
    relatedTitles(media, pool).map((item) => item.id),
    ['school-romance', 'romantic-comedy', 'dark-romance'],
  );
  assert.equal(recommendationQuery({ id: 'unknown', category: 'MANGA' }), null);
  assert.deepEqual(relatedTitles({ id: 'unknown', category: 'MANGA' }, pool), []);
});

test('anime and manhwa use the same relevance rules and science fiction aliases match', () => {
  for (const category of ['ANIME', 'MANHWA']) {
    const media = { id: 'source', category, genres: ['Drama', 'Science Fiction'] };
    const candidate = {
      id: 'match',
      category,
      genres: ['Sci-Fi', 'Drama'],
      cover: 'https://example.com/cover.jpg',
    };
    assert.deepEqual(
      relatedTitles(media, [candidate, { ...candidate, id: 'unrelated', genres: ['Drama'] }]),
      [candidate],
    );
  }
});
