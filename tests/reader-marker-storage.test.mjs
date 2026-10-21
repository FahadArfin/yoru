import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setReaderAccount,
  saveReadingState,
  getReadingState,
  mergeReaderMarkers,
  prepareReaderMarkers,
} from '../src/reader/storage.js';

test('bookmark queue preserves removal, old migration dates, newer pending changes and account isolation', () => {
  const data = new Map();
  const savedWindow = globalThis.window,
    savedStorage = globalThis.localStorage;
  globalThis.window = { dispatchEvent() {} };
  globalThis.localStorage = {
    getItem: (k) => data.get(k) || null,
    setItem: (k, v) => data.set(k, v),
  };
  try {
    setReaderAccount('alice');
    data.set(
      'yoru:reader:account:alice:mal-manga-21',
      JSON.stringify({ updatedAt: 100, chapters: { one: { bookmark: 2, read: true } } }),
    );
    const upgraded = prepareReaderMarkers('alice', 'mal-manga-21');
    assert.equal(upgraded.one.bookmark.at, 100);
    mergeReaderMarkers('alice', 'mal-manga-21', { one: { bookmark: 5, bookmarkAt: 200 } });
    assert.equal(getReadingState('mal-manga-21').chapters.one.bookmark, 5);
    saveReadingState('mal-manga-21', {}, 'one', { bookmark: null });
    const pending = prepareReaderMarkers('alice', 'mal-manga-21').one.bookmark;
    mergeReaderMarkers(
      'alice',
      'mal-manga-21',
      { one: { bookmark: 2, bookmarkAt: 100 } },
      { chapterId: 'one', field: 'bookmark', at: 100 },
    );
    assert.equal(getReadingState('mal-manga-21').chapters.one.bookmark, null);
    assert.equal(prepareReaderMarkers('alice', 'mal-manga-21').one.bookmark.at, pending.at);
    mergeReaderMarkers(
      'alice',
      'mal-manga-21',
      { one: { bookmark: null, bookmarkAt: pending.at } },
      { chapterId: 'one', field: 'bookmark', at: pending.at },
    );
    assert.equal(prepareReaderMarkers('alice', 'mal-manga-21').one.bookmark, undefined);
    setReaderAccount('bob');
    mergeReaderMarkers('alice', 'mal-manga-21', { one: { bookmark: 999, bookmarkAt: Date.now() } });
    assert.deepEqual(getReadingState('mal-manga-21').chapters, {});
    assert.deepEqual(prepareReaderMarkers('alice', 'mal-manga-21'), {});
    setReaderAccount('');
    saveReadingState('mal-manga-21', {}, 'guest', { bookmark: 3 });
    setReaderAccount('alice');
    assert.equal(getReadingState('mal-manga-21').chapters.guest, undefined);
  } finally {
    globalThis.window = savedWindow;
    globalThis.localStorage = savedStorage;
  }
});
