import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readerContextContract } from '../reader-context-contract.mjs';
import { createRuntime, migrate, sql } from './harness.mjs';
import { sitesReaderDb, store } from '../../sites/store.js';
import { createExternalCatalogStore } from '../../server/external-catalog-store.js';
import { Response } from 'miniflare';
readerContextContract('D1 across Workers', async () => {
  const runtime = await createRuntime();
  try {
    await migrate(runtime);
    return {
      db: sitesReaderDb(store(await runtime.getD1Database('DB', 'a'))),
      close: () => runtime.dispose(),
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
});
test('two Workers gate native metadata manifests covers and pages by current destination and membership before bytes', async () => {
  const rating = (r) => ({
    rating: r,
    provenance: {
      sourceField: 'source.contentWarning',
      value: r,
      checkedAt: '2026-10-19T00:00:00Z',
    },
  });
  const source = {
    id: 'suwayomi:123',
    integration: 'suwayomi',
    upstreamSourceId: '123',
    providerKey: 'MangaDex',
    language: 'en',
    classification: rating('safe'),
    capabilities: Object.fromEntries(
      ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map((k) => [
        k,
        'supported',
      ]),
    ),
    bridgeInstance: 'fixture',
  };
  let changed = false,
    imageCalls = 0;
  const title = {
    sourceRef: source,
    upstreamRef: { sourceId: source.id, upstreamKey: '/fixture/title', language: 'en' },
    classification: source.classification,
    metadata: {
      title: 'Fixture',
      cover: 'https://private.trycloudflare.com/thumbnail',
      privateUrl: 'secret',
      localMangaId: '123',
    },
  };
  const chapter = {
    sourceRef: source,
    upstreamRef: { title: title.upstreamRef, upstreamKey: '/fixture/chapter' },
    metadata: { number: '1', pages: 1 },
  };
  const runtime = await createRuntime({
    bindings: {
      CATALOG_OFFLINE: '0',
      READER_EXTENSIONS_ENABLED: '1',
      READER_BRIDGE_KEY: 'fixture-bridge-key-more-than-32-characters',
      READER_BRIDGE_URL: 'https://fixture.trycloudflare.com',
    },
    provider: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/extension/details')
        return Response.json(
          changed
            ? {
                ...title,
                sourceRef: { ...source, classification: rating('mixed') },
                classification: rating('mixed'),
              }
            : title,
        );
      if (path === '/extension/reader')
        return Response.json({
          // Details and chapter observations must agree on the current source
          // policy. A stale safe chapter correctly conflicts with mixed authority.
          edition: changed
            ? { ...chapter, sourceRef: { ...source, classification: rating('mixed') } }
            : chapter,
          pages: [0],
        });
      if (path === '/extension/page' || path === '/extension/cover') {
        imageCalls++;
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('PRIVATE ERROR', { status: 503 });
    },
  });
  try {
    await migrate(runtime);
    const db = sitesReaderDb(store(await runtime.getD1Database('DB', 'a'))),
      catalog = createExternalCatalogStore(db);
    const media = await catalog.rememberTitle(title),
      edition = await catalog.rememberEdition(media.id, chapter);
    const paths = [
      `/api/media/${media.id}`,
      `/api/media/${media.id}/cover`,
      `/api/media/${media.id}/reader/${edition.id}`,
      `/api/media/${media.id}/reader/${edition.id}/page/0`,
    ];
    for (const path of paths) {
      const response = await runtime.dispatchFetch(`http://b.test${path}?destination=yoru`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      if (response.headers.get('content-type').includes('json'))
        assert.doesNotMatch(await response.text(), /private.trycloudflare|privateUrl|localMangaId/);
    }
    assert.equal(imageCalls, 2);
    const initial = await runtime.dispatchFetch(
        'http://a.test/api/reader/context?destination=yoru',
      ),
      cookie = initial.headers.get('set-cookie');
    const saved = await runtime.dispatchFetch('http://a.test/api/reader/context', {
      method: 'POST',
      headers: { origin: 'http://a.test', cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        destination: 'yoru',
        expectedRevision: 0,
        selection: { overrides: { MangaDex: { yoru: false } } },
      }),
    });
    assert.equal(saved.status, 200);
    for (const path of paths)
      assert.equal(
        (
          await runtime.dispatchFetch(`http://b.test${path}?destination=yoru`, {
            headers: { cookie },
          })
        ).status,
        404,
      );
    assert.equal(imageCalls, 2);
    changed = true;
    for (const path of paths)
      assert.equal(
        (await runtime.dispatchFetch(`http://b.test${path}?destination=yoru`)).status,
        404,
      );
    assert.equal(imageCalls, 2);
    const araInitial = await runtime.dispatchFetch(
        'http://a.test/api/reader/context?destination=ara-ara',
      ),
      araCookie = araInitial.headers.get('set-cookie');
    assert.equal(
      (
        await runtime.dispatchFetch('http://a.test/api/reader/context', {
          method: 'POST',
          headers: {
            origin: 'http://a.test',
            cookie: araCookie,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            destination: 'ara-ara',
            expectedRevision: 0,
            selection: {
              overrides: { MangaDex: { 'ara-ara': true } },
              modes: { 'ara-ara': 'core' },
            },
          }),
        })
      ).status,
      200,
    );
    for (const path of paths)
      assert.equal(
        (
          await runtime.dispatchFetch(`http://b.test${path}?destination=ara-ara`, {
            headers: { cookie: araCookie },
          })
        ).status,
        200,
      );
    assert.equal(imageCalls, 4);
  } finally {
    await runtime.dispose();
  }
});
test('Sites context cookies isolate guests, enforce origin, persist across Workers and protect native images', async () => {
  const runtime = await createRuntime();
  try {
    await migrate(runtime);
    const get = await runtime.dispatchFetch(
      'https://a.test/api/reader/context?destination=yoru&userId=another',
    );
    assert.equal(get.status, 200);
    const cookie = get.headers.get('set-cookie');
    assert.match(cookie, /yoru_reader_guest=[a-f0-9]{64}/);
    for (const flag of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Max-Age=1800'])
      assert.ok(cookie.includes(flag), cookie);
    const initial = await get.json();
    assert.equal(initial.revision, 0);
    const post = (host, revision, origin = `https://${host}`) =>
      runtime.dispatchFetch(`https://${host}/api/reader/context`, {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          destination: 'yoru',
          expectedRevision: revision,
          selection: { overrides: { MangaDex: { yoru: false } } },
        }),
      });
    assert.equal((await post('b.test', 0, 'https://attacker.test')).status, 403);
    assert.equal((await post('b.test', 0)).status, 200);
    assert.equal((await post('a.test', 0)).status, 409);
    assert.equal(
      (
        await (
          await runtime.dispatchFetch('https://a.test/api/reader/context?destination=yoru', {
            headers: { cookie },
          })
        ).json()
      ).revision,
      1,
    );
    assert.equal(
      (
        await (
          await runtime.dispatchFetch('https://b.test/api/reader/context?destination=yoru')
        ).json()
      ).revision,
      0,
    );
    const id = `ext-manga-${'a'.repeat(32)}`;
    for (const path of [
      `/api/media/${id}?destination=yoru`,
      `/api/media/${id}/cover?destination=yoru`,
      `/api/media/${id}/reader/ext-chapter-${'b'.repeat(32)}/page/0?destination=yoru`,
    ]) {
      const response = await runtime.dispatchFetch(`https://a.test${path}`);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.doesNotMatch(await response.text(), /trycloudflare|Bearer|READER_BRIDGE/);
    }
  } finally {
    await runtime.dispose();
  }
});
