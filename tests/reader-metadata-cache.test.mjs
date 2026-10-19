import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('metadata freshness, bounded stale fallback and source deletion use an injected clock', async () => {
  const { MetadataCache } = await import('../services/reader-bridge/metadata-cache.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'yoru-metadata-'));
  let now = 0,
    calls = 0;
  const cache = new MetadataCache(directory, { now: () => now });
  const options = { kind: 'feed', sourceId: 'suwayomi:1' };
  const load = async () => ({ n: ++calls });
  const fail = async () => {
    throw Object.assign(new Error('offline'), { status: 503 });
  };
  try {
    assert.deepEqual(await cache.getOrFetch('feed', options, load), {
      data: { n: 1 },
      stale: false,
    });
    now = 299999;
    assert.equal((await cache.getOrFetch('feed', options, load)).data.n, 1);
    now = 300000;
    assert.equal((await cache.getOrFetch('feed', options, fail)).stale, true);
    now = 3600001;
    await assert.rejects(cache.getOrFetch('feed', options, fail), /offline/);
    await cache.getOrFetch('detail', { ...options, kind: 'details' }, load);
    await cache.invalidateSource(options.sourceId);
    assert.equal(
      (await cache.getOrFetch('detail', { ...options, kind: 'details' }, load)).data.n,
      3,
    );
    now += 3600000;
    assert.equal(
      (await cache.getOrFetch('detail', { ...options, kind: 'details' }, fail)).stale,
      true,
    );
    now += 24 * 3600000;
    await assert.rejects(
      cache.getOrFetch('detail', { ...options, kind: 'details' }, fail),
      /offline/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejections are not cached and canceling one coalesced subscriber preserves the other', async () => {
  const { MetadataCache } = await import('../services/reader-bridge/metadata-cache.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'yoru-coalesced-'));
  const cache = new MetadataCache(directory);
  const options = { kind: 'feed', sourceId: 'suwayomi:1' };
  try {
    await assert.rejects(
      cache.getOrFetch('x', options, async () => {
        throw new Error('bad');
      }),
    );
    let release,
      calls = 0;
    const loader = async () => {
      calls++;
      return new Promise((r) => {
        release = r;
      });
    };
    const controller = new AbortController();
    const first = cache.getOrFetch('x', options, loader, { signal: controller.signal });
    const rejected = assert.rejects(first, { name: 'AbortError' });
    const second = cache.getOrFetch('x', options, loader);
    while (!release) await new Promise((r) => setImmediate(r));
    controller.abort();
    release('ok');
    await rejected;
    assert.equal((await second).data, 'ok');
    assert.equal(calls, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('metadata cache evicts by entries and bytes and never persists an oversized entry', async () => {
  const { MetadataCache } = await import('../services/reader-bridge/metadata-cache.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'yoru-budget-'));
  let now = 0;
  const cache = new MetadataCache(directory, { maxEntries: 2, maxBytes: 1000, now: () => ++now });
  const options = { kind: 'feed', sourceId: 'suwayomi:1' };
  try {
    for (const key of ['a', 'b', 'c']) await cache.getOrFetch(key, options, async () => key);
    assert.equal((await readdir(directory)).length, 2);
    await cache.getOrFetch('large', options, async () => 'x'.repeat(2000));
    assert.equal((await readdir(directory)).length, 2);
    const tight = new MetadataCache(directory, {
      maxEntries: 5000,
      maxBytes: 210,
      now: () => ++now,
    });
    await tight.getOrFetch('d', options, async () => 'value');
    const files = await readdir(directory);
    const sizes = await Promise.all(files.map((file) => stat(join(directory, file))));
    assert.ok(sizes.reduce((total, file) => total + file.size, 0) <= 210);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
