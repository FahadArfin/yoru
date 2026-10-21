import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextFixture } from './reader-context-fixture.mjs';
import { decimalSourceId } from '../services/reader-bridge/suwayomi-operations.mjs';
import express from 'express';
const valid = ['-1', '-9223372036854775808', '9223372036854775807'];
const invalid = [
  '0',
  '-0',
  '01',
  '-01',
  '+1',
  '9223372036854775808',
  '-9223372036854775809',
  '1234567890123456789012345',
  1,
  null,
];
const rating = {
  rating: 'safe',
  provenance: {
    sourceField: 'source.contentWarning',
    value: 'SAFE',
    checkedAt: '2026-10-19T00:00:00Z',
  },
};
const source = (id) => ({
  id: `suwayomi:${id}`,
  integration: 'suwayomi',
  upstreamSourceId: id,
  providerKey: 'MangaDex',
  language: 'en',
  classification: rating,
  capabilities: Object.fromEntries(
    ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map((k) => [
      k,
      'supported',
    ]),
  ),
  bridgeInstance: 'fixture',
});
test('canonical source grammar is signed nonzero 64 bit strings with no normalization', () => {
  for (const id of valid) assert.equal(decimalSourceId(id), id);
  for (const id of invalid) assert.equal(decimalSourceId(id), null);
});
test('gateway accepts the canonical signed source boundaries and rejects overflow before dispatch', async () => {
  const { createExtensionGateway } = await import('../server/extension-gateway.js');
  let calls = 0;
  const bridge = createExtensionGateway({
    bridgeKey: 'fixture-bridge-key-more-than-32-characters',
    bridgeUrl: 'https://fixture.trycloudflare.com',
    extensionsEnabled: true,
    fetchImpl: async (_url, init) => {
      calls++;
      assert.ok(valid.includes(JSON.parse(init.body).titleRef.sourceId.slice(9)));
      return Response.json({ ok: true });
    },
  });
  for (const id of valid)
    assert.equal(
      (await bridge.details({ sourceId: `suwayomi:${id}`, upstreamKey: '/a', language: 'en' })).ok,
      true,
    );
  for (const id of invalid)
    assert.throws(
      () =>
        bridge.details({
          sourceId: typeof id === 'string' ? `suwayomi:${id}` : id,
          upstreamKey: '/a',
          language: 'en',
        }),
      { status: 400 },
    );
  assert.equal(calls, valid.length);
});
test('actual canonical store uses the same signed source grammar without changing identity tuples', async () => {
  const f = contextFixture();
  try {
    const { createExternalCatalogStore } = await import('../server/external-catalog-store.js');
    const store = createExternalCatalogStore(f.db);
    for (const id of valid)
      assert.equal((await store.rememberSource(source(id))).upstreamSourceId, id);
    for (const id of invalid)
      await assert.rejects(store.rememberSource(source(id)), { status: 400 });
  } finally {
    f.close();
  }
});
test('public reader source query accepts signed boundaries and rejects malformed or overflowing IDs before browse', async () => {
  const { registerNodeReaderRoutes } = await import('../server/reader-routes.js');
  const f = contextFixture();
  let currentSource = source(valid[0]),
    calls = 0;
  const app = express(),
    router = express.Router();
  registerNodeReaderRoutes(router, {
    contextOptions: () => ({ db: f.db, extensionsEnabled: true, guestId: 'a'.repeat(64) }),
    chapterOptions: (req) => ({
      readerDb: f.db,
      context: req.readerContext,
      currentSources: [currentSource],
      bridge: {
        browse: async (input) => {
          calls++;
          assert.equal(input.sourceId, currentSource.id);
          return { items: [], hasMore: false, nextPage: null, sourceState: {} };
        },
      },
      media: async () => null,
    }),
    coreSearch: async () => ({ items: [] }),
    cookie: () => 'a'.repeat(64),
    asyncRoute: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
  });
  app.use('/api', router);
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: error.expose ? error.message : 'Unavailable' }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    for (const id of valid) {
      currentSource = source(id);
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/reader/discovery?integration=extensions&source=${encodeURIComponent(currentSource.id)}`,
      );
      assert.equal(response.status, 200);
    }
    assert.equal(calls, valid.length);
    for (const id of invalid.filter((x) => typeof x === 'string'))
      assert.equal(
        (
          await fetch(
            `http://127.0.0.1:${server.address().port}/api/reader/discovery?integration=extensions&source=${encodeURIComponent(`suwayomi:${id}`)}`,
          )
        ).status,
        400,
      );
    assert.equal(calls, valid.length);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    f.close();
  }
});
