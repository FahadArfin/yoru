import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as preferences from '../src/reader/catalog-preferences.js';
import { cachedApi, peek } from '../src/api.js';
import { normalizeGuestSelection, selectionProjection } from '../shared/catalog-selection.js';
import {
  loadCatalogPreferences,
  saveCatalogPreference,
  resetCatalogPreferences,
} from '../src/reader/catalog-preferences.js';

test('authoritative snapshots above guest quotas retain every account choice through load save and reset', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.window = new EventTarget();
  const cases = [
    Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`provider-${i}`, { yoru: true }])),
    Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [
        `${i}${'漢'.repeat(95)}`,
        { yoru: true, 'ara-ara': false },
      ]),
    ),
  ];
  assert.ok(new TextEncoder().encode(JSON.stringify(cases[1])).byteLength > 16384);
  try {
    for (const [index, overrides] of cases.entries()) {
      const owner = `large-settings-${index}`;
      const expected = { overrides, modes: { yoru: 'all', 'ara-ara': 'all' } };
      assert.throws(() => normalizeGuestSelection(expected), { status: 400 });
      let snapshot = { owner, ...expected, revision: 101 };
      globalThis.fetch = async (_path, options) => {
        if (options.method === 'PATCH') {
          const body = JSON.parse(options.body);
          snapshot = { ...snapshot, revision: snapshot.revision + 1 };
          if (body.operation === 'mode')
            snapshot.modes = { ...snapshot.modes, [body.destination]: body.mode };
          else
            snapshot.overrides = {
              ...snapshot.overrides,
              [body.provider]: {
                ...snapshot.overrides[body.provider],
                [body.destination]: body.enabled,
              },
            };
        } else if (options.method === 'DELETE')
          snapshot = {
            owner,
            overrides: {},
            modes: { yoru: 'all', 'ara-ara': 'all' },
            revision: snapshot.revision + 1,
          };
        return Response.json(snapshot);
      };
      assert.deepEqual((await preferences.loadReaderSettings(owner, true)).overrides, overrides);
      const provider = Object.keys(overrides)[0];
      const saved = await preferences.saveCatalogPreference(owner, provider, 'yoru', false);
      assert.deepEqual(saved, {
        ...overrides,
        [provider]: { ...overrides[provider], yoru: false },
      });
      await preferences.saveIntegrationMode(owner, 'ara-ara', 'extensions');
      const settings = await preferences.loadReaderSettings(owner);
      assert.equal(Object.keys(settings.overrides).length, Object.keys(overrides).length);
      assert.equal(settings.modes['ara-ara'], 'extensions');
      assert.equal(settings.revision, 103);
      assert.deepEqual(await preferences.resetCatalogPreferences(owner), {});
      assert.deepEqual(await preferences.loadReaderSettings(owner), {
        overrides: {},
        modes: { yoru: 'all', 'ara-ara': 'all' },
        revision: 104,
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.window;
  }
});

test('authoritative projection remains sorted and rejects unsafe structures without guest quotas', () => {
  for (const input of [
    { overrides: { MangaDex: { yoru: 'false' } } },
    { overrides: { MangaDex: { unknown: true } } },
    { overrides: { MangaDex: Object.create({ yoru: true }) } },
    { overrides: Object.create({ MangaDex: { yoru: true } }) },
    JSON.parse('{"overrides":{"__proto__":{"yoru":true}}}'),
    { modes: { yoru: 'invalid' } },
    { overrides: [] },
  ])
    assert.throws(() => selectionProjection(input), { status: 400 });
  assert.deepEqual(
    Object.keys(
      selectionProjection({
        overrides: { Zebra: { yoru: true }, Alpha: { yoru: false } },
        owner: 'server-owned',
      }).overrides,
    ),
    ['Alpha', 'Zebra'],
  );
});

test('late A cannot clear or replace B while B remains pending', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = () => new Promise((resolve) => requests.push(resolve));
  try {
    const a = preferences.loadReaderSettings('pending-a', true);
    const b = preferences.loadReaderSettings('pending-b', true);
    requests[0](
      Response.json({
        owner: 'pending-a',
        overrides: {},
        modes: { yoru: 'core', 'ara-ara': 'all' },
        revision: 1,
      }),
    );
    assert.equal((await a).modes.yoru, 'core');
    const secondB = preferences.loadReaderSettings('pending-b', true);
    assert.equal(requests.length, 2);
    requests[1](
      Response.json({
        owner: 'pending-b',
        overrides: {},
        modes: { yoru: 'extensions', 'ara-ara': 'all' },
        revision: 2,
      }),
    );
    assert.equal((await b).modes.yoru, 'extensions');
    assert.deepEqual(await secondB, await b);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test('loading unchanged selection settings keeps prepared chapter metadata in cache', async () => {
  const original = globalThis.fetch;
  const owner = 'prepared-settings-owner';
  const path = '/api/media/mal-manga-21/reader/prepared-metadata';
  let settingsReads = 0;
  globalThis.fetch = async (url) => {
    if (url === '/api/reader/preferences') {
      settingsReads++;
      return Response.json({
        owner,
        revision: 1,
        overrides: {},
        modes: { yoru: 'all', 'ara-ara': 'all' },
      });
    }
    return Response.json({ pages: [{ url: '/api/prepared-page' }] });
  };
  try {
    const prepared = await cachedApi(path, false, { scope: owner });
    await preferences.loadReaderSettings(owner, true);
    await preferences.loadReaderSettings(owner);
    assert.equal(settingsReads, 1);
    assert.equal(peek(path, owner), prepared);
  } finally {
    globalThis.fetch = original;
  }
});
