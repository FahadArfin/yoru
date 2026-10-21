import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedApi, invalidateApi, invalidateScopedApi, peek, readerRequest } from '../src/api.js';
import { chapterListPath } from '../src/reader/requests.js';

test('chapter metadata cache separates accounts and honors a forced refresh', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => Response.json({ myRating: ++requests });
  try {
    const path = '/api/media/mal-manga-21/chapters?test=partition';
    assert.equal((await cachedApi(path, false, { scope: 'account-a' })).myRating, 1);
    assert.equal((await cachedApi(path, false, { scope: 'account-b' })).myRating, 2);
    assert.equal((await cachedApi(path, false, { scope: 'account-a' })).myRating, 1);
    assert.equal((await cachedApi(path, true, { scope: 'account-a' })).myRating, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test('a chapter rating change cannot restore an older in-flight response to the cache', async () => {
  const original = globalThis.fetch;
  let finishOld;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finishOld = resolve;
    });
  try {
    const path = '/api/media/mal-manga-21/chapters?test=invalidation';
    const old = cachedApi(path, false, { scope: 'account-a' });
    invalidateApi('/api/media/mal-manga-21/chapters');
    finishOld(Response.json({ myRating: 1 }));
    await old;
    assert.equal(peek(path, 'account-a'), undefined);
    globalThis.fetch = async () => Response.json({ myRating: 5 });
    assert.equal((await cachedApi(path, false, { scope: 'account-a' })).myRating, 5);
  } finally {
    globalThis.fetch = original;
  }
});

test('an unresolved identity receives no personal vote and never seeds a guest cache entry', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ items: [{ id: 'edition', stats: { views: 10, myRating: 5 } }] });
  try {
    const result = await readerRequest(chapterListPath('mal-manga-21', { q: 'unknown-session' }), {
      scope: null,
      owner: null,
      destination: 'yoru',
      integrationMode: 'all',
      selectionFingerprint: 'unknown-public-session',
      overrides: {},
    });
    assert.equal(result.items[0].stats.myRating, 0);
    assert.equal(result.items[0].stats.views, 10);
    assert.equal(
      peek(chapterListPath('mal-manga-21', { q: 'unknown-session' }), 'guest'),
      undefined,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('changing identity discards old private requests while keeping public metadata', async () => {
  const original = globalThis.fetch;
  let finishOld;
  try {
    globalThis.fetch = async () => Response.json({ title: 'Public title' });
    const publicPath = '/api/media/mal-manga-21?test=public-cache';
    await cachedApi(publicPath);
    globalThis.fetch = () =>
      new Promise((resolve) => {
        finishOld = resolve;
      });
    const path = chapterListPath('mal-manga-21', { q: 'switch-session' });
    const pending = cachedApi(path, false, { scope: 'old-account' });
    invalidateScopedApi();
    finishOld(Response.json({ myRating: 5 }));
    await pending;
    assert.equal(peek(path, 'old-account'), undefined);
    assert.equal(peek(publicPath).title, 'Public title');
  } finally {
    globalThis.fetch = original;
  }
});

test('reader transport reuses only the same owner destination integration and selection', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => Response.json({ request: ++requests });
  const selection = {
    scope: 'scoped-reader-a',
    destination: 'yoru',
    integrationMode: 'all',
    selectionFingerprint: 'first-selection',
  };
  const path = '/api/reader/discovery?q=cache-boundary';
  try {
    assert.equal((await readerRequest(path, selection)).request, 1);
    assert.equal(
      (await readerRequest(path, { ...selection, scope: 'scoped-reader-b' })).request,
      2,
    );
    assert.equal((await readerRequest(path, { ...selection, destination: 'ara-ara' })).request, 3);
    assert.equal(
      (await readerRequest(path, { ...selection, integrationMode: 'extensions' })).request,
      4,
    );
    assert.equal(
      (await readerRequest(path, { ...selection, selectionFingerprint: 'other-selection' }))
        .request,
      5,
    );
    assert.equal((await readerRequest(path, selection)).request, 1);
    assert.equal(requests, 5);
  } finally {
    globalThis.fetch = original;
  }
});
