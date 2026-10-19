import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  loadCatalogPreferences,
  saveCatalogPreference,
  resetCatalogPreferences,
} from '../src/reader/catalog-preferences.js';

test('a slow preferences refresh cannot undo a completed save or reset', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.window = new EventTarget();
  const owner = 'race-owner';
  let resolveGet;
  let overrides = {};
  globalThis.fetch = async (_path, options) => {
    if (!options.method)
      return new Promise((resolve) => {
        resolveGet = resolve;
      });
    if (options.method === 'PATCH') overrides = { MangaDex: { yoru: false } };
    else overrides = {};
    return Response.json({ owner, overrides });
  };
  try {
    const first = loadCatalogPreferences(owner, true);
    await saveCatalogPreference(owner, 'MangaDex', 'yoru', false);
    resolveGet(Response.json({ owner, overrides: {} }));
    assert.deepEqual(await first, { MangaDex: { yoru: false } });
    assert.deepEqual(await loadCatalogPreferences(owner), { MangaDex: { yoru: false } });
    const second = loadCatalogPreferences(owner, true);
    await resetCatalogPreferences(owner);
    resolveGet(Response.json({ owner, overrides: { MangaDex: { yoru: false } } }));
    assert.deepEqual(await second, {});
    assert.deepEqual(await loadCatalogPreferences(owner), {});
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.window;
  }
});

test('legacy guest choices apply on title pages before Settings is opened', async () => {
  const originalFetch = globalThis.fetch;
  const storage = new Map([
    [
      'yoru:reader-catalogs:v1',
      JSON.stringify({ enabled: { yoru: { 1: false } }, araEnabled: { yoru: { 1: true } } }),
    ],
  ]);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.fetch = async () =>
    Response.json({ sources: [{ id: '1', name: 'MangaDex', language: 'en' }] });
  try {
    assert.deepEqual(await loadCatalogPreferences('guest'), {
      MangaDex: { yoru: false, 'ara-ara': true },
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
  }
});
