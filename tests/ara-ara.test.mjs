import test from 'node:test';
import assert from 'node:assert/strict';
import { araTitles, isAraMedia } from '../shared/ara-ara.js';
import { readFileSync } from 'node:fs';
import { getAraCatalog, scopeAraSchedule } from '../server/ara-ara.js';

test('Ara Ara membership requires reviewed IDs, correct category and non-explicit metadata', () => {
  const seed = JSON.parse(readFileSync(new URL('../server/seed.json', import.meta.url)));
  assert.equal(new Set(araTitles.map((x) => x.id)).size, araTitles.length);
  for (const entry of araTitles) {
    const media = seed.items.find((x) => x.id === entry.id);
    assert.ok(isAraMedia(media), entry.id);
    assert.equal(isAraMedia({ ...media, isAdult: true }), false);
    assert.equal(isAraMedia({ ...media, genres: ['Erotica'] }), false);
    assert.equal(isAraMedia({ ...media, rating: 'Rx - Hentai' }), false);
    assert.equal(isAraMedia({ ...media, category: 'OTHER' }), false);
  }
  assert.equal(isAraMedia({ id: 'mal-anime-1', category: 'ANIME' }), false);
  assert.equal(isAraMedia(null), false);
});

test('catalog omits missing and reclassified records without substituting other titles', async () => {
  const seed = JSON.parse(readFileSync(new URL('../server/seed.json', import.meta.url)));
  const result = await getAraCatalog(async (id) => {
    if (id === araTitles[0].id) throw new Error('Provider unavailable');
    const media = seed.items.find((item) => item.id === id);
    return id === araTitles[1].id ? { ...media, isAdult: true } : media;
  });
  assert.equal(result.items.length, 10);
  assert.equal(result.unavailable, 2);
  assert.ok(result.items.every(isAraMedia));
});

test('schedule matches exact reviewed identities and retains provider state and pagination', async () => {
  const catalog = async () => ({
    items: [
      { id: 'mal-anime-37521', category: 'ANIME', title: 'Vinland Saga' },
      { id: 'mal-manga-21', category: 'MANGA', title: 'Death Note' },
    ],
  });
  const result = {
    state: 'stale',
    nextOffset: 100,
    items: [
      { id: 'match', title: 'VINLAND SAGA', episode: 1 },
      { id: 'sequel', title: 'Vinland Saga Season 2' },
      { id: 'wrong-id', title: 'Vinland Saga', mediaId: 'mal-anime-1' },
      { id: 'chapter', title: 'Local alias', mediaId: 'mal-manga-21', chapter: '1' },
    ],
  };
  const anime = await scopeAraSchedule(result, 'ANIME', catalog);
  assert.deepEqual(
    anime.items.map((item) => item.id),
    ['match'],
  );
  assert.equal(anime.items[0].mediaId, 'mal-anime-37521');
  assert.equal(anime.state, 'stale');
  const manga = await scopeAraSchedule(result, 'MANGA', catalog);
  assert.deepEqual(
    manga.items.map((item) => item.id),
    ['chapter'],
  );
  assert.equal(manga.nextOffset, 100);
});
