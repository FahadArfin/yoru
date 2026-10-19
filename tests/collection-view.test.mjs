import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionRequest, collectionView } from '../shared/collection-view.js';
import { collectionPath } from '../src/collection-context.js';
test('native title detail is resolved independently of the reviewed Ara shelf', () => {
  const id = 'ext-manga-' + 'a'.repeat(32);
  const path = `/api/media/${id}`;
  const data = { media: { id, title: 'Provider native title', category: 'MANGA' } };
  assert.equal(collectionRequest(path, true), `${path}?destination=ara-ara`);
  assert.equal(collectionView(path, data, { items: [] }), data);
});
const catalog = {
  items: [
    {
      id: 'mal-manga-21',
      title: 'Death Note',
      category: 'MANGA',
      genres: ['Mystery'],
      year: 2003,
      popularity: 1,
    },
    {
      id: 'mal-anime-16498',
      title: 'Attack on Titan',
      category: 'ANIME',
      genres: ['Action'],
      year: 2013,
      popularity: 2,
    },
  ],
};
test('collection paths preserve queries and stay in Ara Ara without rewriting external links', () => {
  for (const [from, to] of [
    ['/', '/ara-ara'],
    ['/?category=manga', '/ara-ara?category=manga'],
    ['/browse/manga?q=death', '/ara-ara/manga?q=death'],
    ['/watch/mal-anime-16498/1?language=dub', '/ara-ara/watch/mal-anime-16498/1?language=dub'],
    ['/community/x/1', '/ara-ara/community/x/1'],
    ['https://example.com', 'https://example.com'],
    ['//example.com', '//example.com'],
    ['/api/auth/discord', '/api/auth/discord'],
  ]) {
    assert.equal(collectionPath(from, true), to);
    assert.equal(collectionPath(from, false), from);
  }
});
test('collection results never fill an empty shelf with outside titles', () => {
  assert.deepEqual(
    collectionView('/api/catalog?category=MANGA&search=death', null, catalog).items.map(
      (x) => x.id,
    ),
    ['mal-manga-21'],
  );
  assert.equal(collectionView('/api/catalog?category=MANGA&search=naruto', null, catalog).total, 0);
  assert.equal(collectionView('/api/media/mal-anime-52991', null, catalog), null);
  assert.equal(
    collectionView(
      '/api/home/discovery?mode=trending&period=week',
      { items: [{ id: 'mal-anime-52991' }] },
      catalog,
    ).items.length,
    0,
  );
  assert.equal(
    collectionView('/api/manga/discovery?mode=new&period=all', null, catalog).items[0].id,
    'mal-manga-21',
  );
  assert.equal(
    collectionView(
      '/api/community/threads',
      { items: [{ mediaId: 'mal-manga-21' }, { mediaId: 'mal-anime-52991' }] },
      catalog,
    ).items.length,
    1,
  );
  assert.equal(
    collectionRequest('/api/calendar?week=2026-10-12', true),
    '/api/calendar?week=2026-10-12&collection=ara-ara',
  );
  assert.equal(
    collectionRequest('/api/calendar?week=2026-10-12', false),
    '/api/calendar?week=2026-10-12',
  );
});
