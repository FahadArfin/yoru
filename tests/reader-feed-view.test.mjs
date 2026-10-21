import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeReadingPage,
  readingFeedKey,
  visibleReadingItems,
  readingSuggestions,
} from '../src/reader/feed.js';
import { coverCandidates } from '../src/image-loading.js';
import { accountSource, accountClassification } from './extension-account-contract.mjs';

test('reader feed consumer merges exact choices across more than four source batches including terminal updates', () => {
  const choice = (n) => ({ mediaId: `edition-${n}`, integration: n === 0 ? 'core' : 'suwayomi' });
  const original = {
    id: 'representative',
    title: 'First metadata',
    readingChoices: [choice(0)],
    selectedEdition: 'saved-chapter',
    page: 8,
  };
  let feed = mergeReadingPage(null, { items: [original], nextCursor: '1', hasMore: true });
  for (let n = 1; n <= 6; n++)
    feed = mergeReadingPage(feed, {
      items: n === 1 ? [{ id: 'second', title: 'Same name without equivalence' }] : [],
      updates: [{ id: original.id, readingChoices: [choice(n), choice(n)] }],
      nextCursor: n === 6 ? null : String(n + 1),
      hasMore: n !== 6,
      total: null,
      totalIsEstimate: true,
    });
  assert.deepEqual(
    feed.items.map((x) => x.id),
    ['representative', 'second'],
  );
  assert.equal(feed.items[0].readingChoices.length, 7);
  assert.deepEqual(feed.items[0].availableIntegrations, ['core', 'suwayomi']);
  assert.equal(feed.items[0].selectedEdition, 'saved-chapter');
  assert.equal(feed.items[0].page, 8);
  assert.equal(feed.items[0].title, 'First metadata');
  assert.equal(feed.hasMore, false);
  assert.equal(feed.total, null);
});
test('feed identity changes for owner destination selection and query', () => {
  const context = {
    owner: 'a',
    destination: 'yoru',
    integrationMode: 'all',
    selectionFingerprint: 'first',
  };
  const keys = [
    readingFeedKey(context, '/api/reader/browse?q=a'),
    ...[
      { owner: 'b' },
      { destination: 'ara-ara' },
      { selectionFingerprint: 'second' },
      { integrationMode: 'core' },
    ].map((patch) => readingFeedKey({ ...context, ...patch }, '/api/reader/browse?q=a')),
    readingFeedKey(context, '/api/reader/browse?q=b'),
  ];
  assert.equal(new Set(keys).size, 6);
});
test('a hidden core representative surfaces after a terminal native choice without losing its core path', () => {
  const core = {
    id: 'mal-manga-21',
    title: 'Core representative',
    category: 'MANGA',
    readingChoices: [
      {
        mediaId: 'mal-manga-21',
        integration: 'core',
        sourceRef: { id: 'mangadex', providerKey: 'MangaDex', integration: 'core', language: 'en' },
      },
    ],
  };
  const context = { destination: 'yoru', integrationMode: 'all', overrides: {} };
  let feed = mergeReadingPage(null, { items: [core], hasMore: true, nextCursor: 'next' });
  assert.deepEqual(visibleReadingItems(feed.items, { context }), []);
  feed = mergeReadingPage(feed, {
    items: [],
    updates: [
      {
        id: core.id,
        readingChoices: [
          {
            mediaId: 'ext-manga-' + 'c'.repeat(32),
            sourceRef: accountSource(),
            integration: 'suwayomi',
          },
        ],
      },
    ],
    hasMore: false,
  });
  const visible = visibleReadingItems(feed.items, { context });
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, core.id);
  assert.equal(visible[0].readingChoices.length, 2);
  assert.deepEqual(
    visibleReadingItems(feed.items, { context: { ...context, integrationMode: 'core' } }),
    [],
  );
});
test('native covers require current eligible context and only use same-origin destination-bearing delivery', () => {
  const media = {
    id: 'ext-manga-' + 'a'.repeat(32),
    sourceRef: accountSource(),
    classification: accountClassification(),
    cover: 'https://private.example/cover.jpg',
    coverAlternates: ['/unsafe.jpg'],
  };
  assert.deepEqual(coverCandidates(media), []);
  const context = { destination: 'yoru', selectionFingerprint: 'current', overrides: {} };
  assert.deepEqual(coverCandidates(media, context), [
    `/api/media/${media.id}/cover?destination=yoru&selectionFingerprint=current`,
  ]);
  assert.deepEqual(coverCandidates({ ...media, isAdult: true }, context), []);
  assert.deepEqual(coverCandidates(media, { ...context, expiresAt: Date.now() - 1 }), []);
  assert.deepEqual(
    coverCandidates(media, { ...context, overrides: { MangaDex: { yoru: false } } }),
    [],
  );
});
test('suggestions apply current mode destination category and membership without inferring manhwa', () => {
  const native = {
    id: 'ext-manga-' + 'a'.repeat(32),
    category: 'MANGA',
    sourceRef: accountSource(),
    classification: accountClassification(),
  };
  const core = { id: 'mal-manga-21', category: 'MANGA' };
  const anime = { id: 'mal-anime-1', category: 'ANIME' };
  const adult = {
    ...native,
    id: 'ext-manga-' + 'b'.repeat(32),
    isAdult: true,
    sourceRef: accountSource('456', 'mixed', 'NHentai.to'),
    classification: accountClassification('adult'),
  };
  const context = { destination: 'yoru', integrationMode: 'all', overrides: {} };
  assert.deepEqual(
    readingSuggestions([core, anime, native, adult, native], context).map((x) => x.id),
    [core.id, anime.id, native.id],
  );
  assert.deepEqual(readingSuggestions([core, native], { ...context, integrationMode: 'core' }), [
    core,
  ]);
  assert.deepEqual(
    readingSuggestions([core, native], { ...context, integrationMode: 'extensions' }),
    [native],
  );
  assert.deepEqual(readingSuggestions([native], context, 'manhwa'), []);
  assert.deepEqual(
    readingSuggestions([native], { ...context, overrides: { MangaDex: { yoru: false } } }),
    [],
  );
  assert.deepEqual(readingSuggestions([adult], { ...context, destination: 'ara-ara' }), [adult]);
});
