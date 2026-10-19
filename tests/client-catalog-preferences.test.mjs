import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as preferences from '../src/reader/catalog-preferences.js';
import {
  loadCatalogPreferences,
  saveCatalogPreference,
  resetCatalogPreferences,
} from '../src/reader/catalog-preferences.js';

test('stale reads and revoked sessions cannot overwrite newer choices', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.window = new EventTarget();
  const requests = [];
  globalThis.fetch = (_path, options) =>
    new Promise((resolve) => requests.push({ options, resolve }));
  const snapshot = (
    owner,
    revision,
    modes = { yoru: 'all', 'ara-ara': 'all' },
    overrides = {},
  ) => ({ owner, revision, modes, overrides });
  try {
    const a = preferences.loadReaderSettings('settings-a', true);
    const b = preferences.loadReaderSettings('settings-b', true);
    requests[1].resolve(
      Response.json(snapshot('settings-b', 2, { yoru: 'extensions', 'ara-ara': 'all' })),
    );
    assert.equal((await b).modes.yoru, 'extensions');
    const save = preferences.saveIntegrationMode('settings-a', 'yoru', 'core');
    assert.deepEqual(JSON.parse(requests[2].options.body), {
      owner: 'settings-a',
      operation: 'mode',
      destination: 'yoru',
      mode: 'core',
    });
    requests[2].resolve(
      Response.json(snapshot('settings-a', 3, { yoru: 'core', 'ara-ara': 'all' })),
    );
    await save;
    requests[0].resolve(Response.json(snapshot('settings-a', 1)));
    assert.equal((await a).modes.yoru, 'core');
    assert.equal((await preferences.loadReaderSettings('settings-b')).modes.yoru, 'extensions');
    const stale = preferences.loadReaderSettings('settings-a', true);
    const reset = preferences.resetCatalogPreferences('settings-a');
    requests[4].resolve(Response.json(snapshot('settings-a', 4)));
    await reset;
    requests[3].resolve(
      Response.json(snapshot('settings-a', 3, { yoru: 'core', 'ara-ara': 'all' })),
    );
    assert.deepEqual((await stale).modes, { yoru: 'all', 'ara-ara': 'all' });
    const revoked = preferences.saveIntegrationMode('settings-a', 'yoru', 'extensions');
    requests[5].resolve(Response.json({ error: 'Session revoked' }, { status: 401 }));
    await assert.rejects(revoked, /Session revoked/);
    assert.equal((await preferences.loadReaderSettings('settings-a')).revision, 4);
    const wrongOwner = preferences.loadReaderSettings('settings-a', true);
    requests[6].resolve(Response.json(snapshot('settings-b', 9)));
    await assert.rejects(wrongOwner, /account changed/);
    assert.equal((await preferences.loadReaderSettings('settings-b')).revision, 2);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.window;
  }
});

test('out of order mutation responses cannot undo a newer reset or independent choice', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.window = new EventTarget();
  const requests = [];
  globalThis.fetch = () => new Promise((resolve) => requests.push(resolve));
  try {
    const old = preferences.saveCatalogPreference('mutation-race', 'MangaDex', 'yoru', false);
    const mode = preferences.saveIntegrationMode('mutation-race', 'ara-ara', 'extensions');
    const reset = preferences.resetCatalogPreferences('mutation-race');
    requests[2](
      Response.json({
        owner: 'mutation-race',
        overrides: {},
        modes: { yoru: 'all', 'ara-ara': 'all' },
        revision: 3,
      }),
    );
    await reset;
    requests[1](
      Response.json({
        owner: 'mutation-race',
        overrides: { MangaDex: { yoru: false } },
        modes: { yoru: 'all', 'ara-ara': 'extensions' },
        revision: 2,
      }),
    );
    await mode;
    requests[0](
      Response.json({
        owner: 'mutation-race',
        overrides: { MangaDex: { yoru: false } },
        modes: { yoru: 'all', 'ara-ara': 'all' },
        revision: 1,
      }),
    );
    await old;
    assert.deepEqual(await preferences.loadReaderSettings('mutation-race'), {
      overrides: {},
      modes: { yoru: 'all', 'ara-ara': 'all' },
      revision: 3,
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.window;
  }
});

test('guest modes use separate storage and global reset preserves shipped membership migration', async () => {
  globalThis.window = new EventTarget();
  const storage = new Map([
    ['yoru:catalog-overrides:guest:v1', JSON.stringify({ MangaDex: { yoru: false } })],
  ]);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  try {
    await preferences.saveIntegrationMode('guest', 'ara-ara', 'extensions');
    assert.deepEqual(JSON.parse(storage.get('yoru:reader-integration-modes:guest:v1')), {
      yoru: 'all',
      'ara-ara': 'extensions',
    });
    assert.deepEqual(await preferences.loadCatalogPreferences('guest'), {
      MangaDex: { yoru: false },
    });
    await preferences.resetCatalogPreferences('guest');
    assert.deepEqual(await preferences.loadReaderSettings('guest'), {
      overrides: {},
      modes: { yoru: 'all', 'ara-ara': 'all' },
      revision: 0,
    });
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
  }
});

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
