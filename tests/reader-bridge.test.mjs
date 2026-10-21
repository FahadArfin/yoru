import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function localBridge(provider) {
  const { createBridgeServer } = await import('../services/reader-bridge/server.mjs');
  const key = 'x'.repeat(32);
  const server = createBridgeServer({ key, provider, extensionsEnabled: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    send() {
      const request = httpRequest({
        host: '127.0.0.1',
        port: server.address().port,
        path: '/extension/browse',
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, connection: 'close' },
      });
      request.on('error', () => {});
      request.end('{}');
      return request;
    },
    async close() {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    },
  };
}

test('real HTTP disconnect removes queued generic work before an upstream request', async () => {
  const { createSuwayomiClient } = await import('../services/reader-bridge/suwayomi-client.mjs');
  const blocker = deferred(),
    entered = deferred();
  let upstreamCalls = 0;
  const client = createSuwayomiClient({
    url: 'http://fixture',
    fetchImpl: async () => {
      upstreamCalls++;
      return Response.json({ data: { sources: { nodes: [] } } });
    },
  });
  const active = client.queue.run(() => blocker.promise);
  const bridge = await localBridge({
    extensions: {
      browse(_input, context) {
        entered.resolve(context.signal);
        return client.execute('sources', {}, context);
      },
    },
  });
  try {
    const request = bridge.send();
    const signal = await entered.promise;
    assert.equal(client.queue.snapshot().pending, 1);
    const aborted = new Promise((resolve) =>
      signal.addEventListener('abort', () => resolve(true), { once: true }),
    );
    request.destroy();
    assert.equal(
      await Promise.race([aborted, delay(250, false)]),
      true,
      'client disconnect must abort its operation context',
    );
    assert.equal(client.queue.snapshot().pending, 0);
    blocker.resolve();
    await active;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(upstreamCalls, 0);
  } finally {
    blocker.resolve();
    await active;
    await bridge.close();
  }
});

test('real HTTP disconnect aborts active upstream work while normal responses keep a live signal', async () => {
  const { createSuwayomiClient } = await import('../services/reader-bridge/suwayomi-client.mjs');
  const dispatched = deferred(),
    aborted = deferred();
  const client = createSuwayomiClient({
    url: 'http://fixture',
    fetchImpl: async (_url, options) => {
      dispatched.resolve();
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener(
          'abort',
          () => {
            aborted.resolve(true);
            reject(new DOMException('Cancelled', 'AbortError'));
          },
          { once: true },
        ),
      );
    },
  });
  let complete = false,
    completedSignal;
  const bridge = await localBridge({
    extensions: {
      browse(_input, context) {
        if (complete) {
          completedSignal = context.signal;
          return { items: [], hasMore: false };
        }
        return client.execute('sources', {}, context);
      },
    },
  });
  try {
    const request = bridge.send();
    await dispatched.promise;
    request.destroy();
    assert.equal(
      await Promise.race([aborted.promise, delay(250, false)]),
      true,
      'client disconnect must abort active transport',
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.queue.snapshot().active, 0);
    complete = true;
    const normal = bridge.send();
    const [response] = await once(normal, 'response');
    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(Buffer.concat(chunks)).hasMore, false);
    await delay(10);
    assert.equal(
      completedSignal.aborted,
      false,
      'a normally completed response must not abort its operation context',
    );
  } finally {
    await bridge.close();
  }
});

test('source matching requires the exact MAL mapping and preserves distinct source editions', async () => {
  const { mappedSources, sourceIdentity } = await import('../services/reader-bridge/providers.mjs');
  const media = { id: 'mal-manga-121496', title: 'Solo Leveling', category: 'MANHWA' };
  const row = {
    malId: 121496,
    type: 'manga',
    title: 'Solo Leveling',
    url: 'https://weebcentral.com/series/01J76XYCPSY3C4BNPBRY8JMCBE',
  };
  const data = {
    id: 121496,
    type: 'manga',
    Sites: {
      Weebcentral: {
        a: row,
        b: {
          ...row,
          title: 'Solo Leveling (Volume)',
          url: 'https://weebcentral.com/series/01J76XYEJVJ5H6AXPYWS4G0CFV',
        },
      },
    },
  };
  assert.deepEqual(
    mappedSources(media, data).map((x) => x.identity),
    ['01j76xycpsy3c4bnpbry8jmcbe'],
  );
  assert.deepEqual(mappedSources(media, { ...data, id: 999 }), []);
  assert.equal(
    sourceIdentity(
      'weebcentral',
      'https://weebcentral.com.evil.test/series/01J76XYCPSY3C4BNPBRY8JMCBE',
    ),
    null,
  );
  assert.equal(
    sourceIdentity(
      'weebcentral',
      'https://weebcentral.com/series/01J76XYCPSY3C4BNPBRY8JMCBE/Solo-Leveling',
    ),
    '01j76xycpsy3c4bnpbry8jmcbe',
  );
});

test('page cache reuses images, expires them and evicts old entries within its byte budget', async () => {
  const { ImageCache } = await import('../services/reader-bridge/cache.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'yoru-reader-'));
  let now = 1000;
  const cache = new ImageCache(dir, { maxBytes: 8, ttl: 100, now: () => now });
  try {
    await cache.put('a', Buffer.from('abcd'), 'image/png');
    assert.equal((await cache.get('a')).body.toString(), 'abcd');
    now += 1;
    await cache.put('b', Buffer.from('efghij'), 'image/jpeg');
    assert.equal(await cache.get('a'), null);
    assert.equal((await cache.get('b')).type, 'image/jpeg');
    now += 101;
    assert.equal(await cache.get('b'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('bridge rejects unauthenticated access and never exposes arbitrary upstream paths', async () => {
  const { bridgeHandler } = await import('../services/reader-bridge/server.mjs');
  const key = 'test-reader-key-with-32-characters-minimum';
  const handler = bridgeHandler({ key, provider: { sources: async () => ({ sources: [] }) } });
  assert.equal(
    (await handler(new Request('http://bridge/sources', { method: 'POST', body: '{}' }))).status,
    401,
  );
  assert.equal(
    (
      await handler(
        new Request('http://bridge/api/graphql', { headers: { authorization: `Bearer ${key}` } }),
      )
    ).status,
    404,
  );
  const bad = await handler(
    new Request('http://bridge/sources', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: JSON.stringify({ media: { id: 'mal-anime-1', category: 'ANIME' } }),
    }),
  );
  assert.equal(bad.status, 400);
});

test('idle cache maintenance expires images without waiting for another reader', async () => {
  const { ImageCache } = await import('../services/reader-bridge/cache.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'yoru-idle-cache-'));
  let now = 0;
  try {
    const cache = new ImageCache(dir, { ttl: 100, now: () => now });
    await cache.put('chapter/page', Buffer.from('image'), 'image/png');
    now = 101;
    await cache.prune();
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tunnel registration accepts only a success banner, never a TLS error containing an API URL', async () => {
  const { tunnelAddress } = await import('../services/reader-bridge/server.mjs');
  assert.equal(
    tunnelAddress(
      'failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": TLS error',
    ),
    '',
  );
  assert.equal(
    tunnelAddress(
      'Your quick Tunnel has been created!\n| https://a-test-reader.trycloudflare.com |',
    ),
    'https://a-test-reader.trycloudflare.com',
  );
});

test('cache maintenance removes abandoned writes but preserves recent temporary files', async () => {
  const { ImageCache } = await import('../services/reader-bridge/cache.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'yoru-interrupted-cache-'));
  const now = Date.now();
  const old = `${'a'.repeat(64)}.aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.tmp`;
  const fresh = `${'b'.repeat(64)}.aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.tmp`;
  try {
    await writeFile(join(dir, old), 'abandoned');
    await writeFile(join(dir, fresh), 'in progress');
    await utimes(join(dir, old), new Date(now - 7200000), new Date(now - 7200000));
    await new ImageCache(dir, { now: () => now }).prune();
    assert.deepEqual(await readdir(dir), [fresh]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
