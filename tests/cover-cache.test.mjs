import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const cover = 'https://cdn.myanimelist.net/images/manga/5/260006l.webp';
function storage() {
  const stores = new Map();
  return {
    async keys() {
      return [...stores.keys()];
    },
    async delete(key) {
      return stores.delete(key);
    },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return {
        async match(key) {
          return data.get(typeof key === 'string' ? key : key.url)?.clone();
        },
        async put(key, response) {
          data.set(typeof key === 'string' ? key : key.url, response.clone());
        },
        async keys() {
          return [...data.keys()].map((url) => ({ url }));
        },
        async delete(key) {
          return data.delete(typeof key === 'string' ? key : key.url);
        },
        async addAll() {},
      };
    },
  };
}
function worker(caches, fetch, now = Date.now()) {
  const handlers = {};
  vm.runInNewContext(source, {
    self: {
      addEventListener: (event, handler) => {
        handlers[event] = handler;
      },
      skipWaiting() {},
      clients: { claim() {} },
    },
    caches,
    fetch,
    URL,
    Request,
    Response,
    Headers,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
  });
  return async (url = cover, overrides = {}) => {
    const pending = [];
    let result;
    handlers.fetch({
      request: { url, method: 'GET', mode: 'no-cors', destination: 'image', ...overrides },
      respondWith(promise) {
        result = promise;
      },
      waitUntil(promise) {
        pending.push(promise);
      },
    });
    const response = await result;
    await Promise.all(pending);
    return response;
  };
}
const image = (options = {}) =>
  new Response('cover bytes', {
    headers: {
      'content-type': 'image/webp',
      'cache-control': 'public, max-age=604800',
      ...options,
    },
  });

test('public covers survive a worker restart and need no repeat network request', async () => {
  const cache = storage();
  let calls = 0;
  const fetch = async (request) => {
    calls++;
    assert.equal(request.credentials, 'omit');
    return image();
  };
  assert.equal(await (await worker(cache, fetch)()).text(), 'cover bytes');
  assert.equal(await (await worker(cache, fetch)()).text(), 'cover bytes');
  assert.equal(calls, 1);
});

test('private reader covers and arbitrary hosts bypass the persistent image cache', async () => {
  const run = worker(storage(), () => {
    throw new Error('must not fetch');
  });
  for (const url of [
    'https://yoru.example/api/media/ext-manga-abc/cover?selectionFingerprint=secret',
    'https://private.example/cover.jpg',
    'https://cdn.myanimelist.net/account/avatar.jpg',
  ]) {
    assert.equal(await run(url), undefined);
  }
});

test('bad responses, private responses and oversized covers are not cached', async () => {
  for (const response of [
    new Response('error', { status: 503 }),
    image({ 'cache-control': 'no-store' }),
    new Response('html', { headers: { 'content-type': 'text/html' } }),
    new Response(new Uint8Array(300000), { headers: { 'content-type': 'image/webp' } }),
  ]) {
    let calls = 0;
    const run = worker(storage(), async () => {
      calls++;
      return response.clone();
    });
    await run();
    await run();
    assert.equal(calls, 2);
  }
});

test('expired covers refresh; a temporary outage can reuse a bounded stale copy', async () => {
  const cache = storage();
  const now = Date.now();
  await worker(cache, async () => image(), now)();
  let calls = 0;
  const offline = async () => {
    calls++;
    throw new Error('offline');
  };
  assert.equal(await (await worker(cache, offline, now + 8 * 86400000)()).text(), 'cover bytes');
  assert.equal(calls, 1);
  await assert.rejects(worker(cache, offline, now + 31 * 86400000)(), /offline/);
});

test('cache quota failures do not stop covers from displaying', async () => {
  const run = worker(
    {
      open: async () => {
        throw new Error('QuotaExceededError');
      },
    },
    async () => image(),
  );
  assert.equal(await (await run()).text(), 'cover bytes');
});

test('the persistent cache evicts oldest covers at its fixed storage bound', async () => {
  const cache = storage();
  const run = worker(cache, async () => image());
  for (let index = 1; index <= 165; index++) {
    await run(`https://cdn.myanimelist.net/images/manga/5/${index}l.webp`);
  }
  const saved = await cache.open('yoru-public-covers-v1');
  assert.equal((await saved.keys()).length, 160);
  assert.equal(await saved.match('https://cdn.myanimelist.net/images/manga/5/1l.webp'), undefined);
  assert.ok(await saved.match('https://cdn.myanimelist.net/images/manga/5/165l.webp'));
});
