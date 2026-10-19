import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntime, migrate } from './harness.mjs';
import { sitesReaderDb, store } from '../../sites/store.js';
import { createExternalCatalogStore } from '../../server/external-catalog-store.js';
import { Response } from 'miniflare';
test('Sites public native errors retain auth access and backoff reasons while hiding private upstream bodies', async () => {
  let status = 401,
    retry = '60';
  const runtime = await createRuntime({
    bindings: {
      CATALOG_OFFLINE: '0',
      READER_EXTENSIONS_ENABLED: '1',
      READER_BRIDGE_KEY: 'fixture-bridge-key-more-than-32-characters',
      READER_BRIDGE_URL: 'https://fixture.trycloudflare.com',
    },
    provider: async () =>
      new Response('PRIVATE Bearer https://private.trycloudflare.com', {
        status,
        headers: { 'retry-after': retry },
      }),
  });
  try {
    await migrate(runtime);
    const db = sitesReaderDb(store(await runtime.getD1Database('DB', 'a')));
    const classification = {
      rating: 'safe',
      provenance: {
        sourceField: 'source.contentWarning',
        value: 'safe',
        checkedAt: '2026-10-19T00:00:00Z',
      },
    };
    const source = {
      id: 'suwayomi:123',
      integration: 'suwayomi',
      upstreamSourceId: '123',
      providerKey: 'MangaDex',
      language: 'en',
      classification,
      bridgeInstance: 'fixture',
      capabilities: Object.fromEntries(
        ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map((k) => [
          k,
          'supported',
        ]),
      ),
    };
    const media = await createExternalCatalogStore(db).rememberTitle({
      sourceRef: source,
      upstreamRef: { sourceId: source.id, upstreamKey: '/a', language: 'en' },
      classification,
      metadata: { title: 'A' },
    });
    for (const [code, reason] of [
      [401, 'auth-required'],
      [403, 'access-challenge'],
      [429, 'rate-limited'],
    ]) {
      status = code;
      const response = await runtime.dispatchFetch(
          `http://b.test/api/media/${media.id}/cover?destination=yoru`,
        ),
        body = await response.json();
      assert.equal(response.status, code);
      assert.equal(response.headers.get('retry-after'), '60');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(body.reason, reason);
      assert.equal(body.retryAfter, '60');
      assert.ok(Number.isFinite(Date.parse(body.retryAt)));
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE|Bearer|trycloudflare/);
    }
    retry = new Date(Date.now() + 90000).toUTCString();
    let response = await runtime.dispatchFetch(
      `http://a.test/api/media/${media.id}?destination=yoru`,
    );
    assert.equal(response.headers.get('retry-after'), retry);
    assert.equal((await response.json()).retryAt, new Date(retry).toISOString());
    retry = 'https://private.trycloudflare.com';
    response = await runtime.dispatchFetch(`http://a.test/api/media/${media.id}?destination=yoru`);
    assert.equal(response.headers.get('retry-after'), null);
    assert.equal((await response.json()).retryAt, undefined);
  } finally {
    await runtime.dispose();
  }
});
