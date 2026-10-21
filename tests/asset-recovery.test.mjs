import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAssetLoadError, recoverAssetLoad } from '../src/asset-recovery.js';

function browser() {
  const storage = new Map();
  return {
    navigator: { onLine: true },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    location: {
      reload() {
        this.reloads++;
      },
      reloads: 0,
    },
  };
}
const missing = new TypeError(
  'Failed to fetch dynamically imported module: https://yoru.test/assets/Settings-old.js',
);

test('removed JavaScript and CSS chunks are distinguished from application and API errors', () => {
  for (const message of [
    missing.message,
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/Settings-old.css',
  ])
    assert.equal(isAssetLoadError(new Error(message)), true);
  for (const error of [
    null,
    {},
    new Error('Failed to fetch'),
    new Error('Cannot read properties of undefined'),
  ])
    assert.equal(isAssetLoadError(error), false);
});

test('a stale chunk refreshes the current URL once and the guard survives a new application instance', () => {
  const first = browser();
  assert.equal(recoverAssetLoad(missing, first, 1000), true);
  const next = {
    ...first,
    location: {
      reloads: 0,
      reload() {
        this.reloads++;
      },
    },
  };
  assert.equal(recoverAssetLoad(missing, next, 1100), false);
  assert.equal(first.location.reloads, 1);
  assert.equal(next.location.reloads, 0);
  assert.equal(recoverAssetLoad(missing, next, 301001), true);
});

test('offline requests and unrelated render failures never trigger automatic navigation', () => {
  const client = browser();
  client.navigator.onLine = false;
  assert.equal(recoverAssetLoad(missing, client), false);
  client.navigator.onLine = true;
  assert.equal(recoverAssetLoad(new Error('Render failed'), client), false);
  assert.equal(client.location.reloads, 0);
});

test('blocked and non-persistent session storage cannot create a reload loop', () => {
  for (const storage of [
    {
      getItem() {
        throw new Error('Blocked');
      },
    },
    { getItem: () => null, setItem() {} },
  ]) {
    const client = browser();
    client.sessionStorage = storage;
    assert.equal(recoverAssetLoad(missing, client), false);
    assert.equal(client.location.reloads, 0);
  }
});
