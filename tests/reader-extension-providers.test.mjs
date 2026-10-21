import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureFetch, sourceId, source, manga } from './fixtures/suwayomi.mjs';

async function adapter(fetchImpl = fixtureFetch(), extra = {}) {
  const { createSuwayomiClient } = await import('../services/reader-bridge/suwayomi-client.mjs');
  const { ExtensionProviders } = await import('../services/reader-bridge/extension-providers.mjs');
  return new ExtensionProviders({
    client: createSuwayomiClient({ url: 'http://fixture', fetchImpl }),
    now: () => 1000,
    ...extra,
  });
}

test('remote feeds discover unindexed titles and retain continuation', async () => {
  const calls = [];
  const remote = fixtureFetch();
  const provider = await adapter((url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    return remote(url, opts);
  });
  const feed = await provider.browse({
    sourceId: `suwayomi:${sourceId}`,
    mode: 'popular',
    page: 1,
  });
  assert.equal(feed.items[0].upstreamRef.upstreamKey, '/series/new');
  assert.equal(feed.items[0].upstreamRef.sourceId, `suwayomi:${sourceId}`);
  assert.equal(feed.items[0].localMangaId, '7');
  assert.equal(feed.items[0].sourceRef.upstreamSourceId, sourceId);
  assert.equal(feed.items[0].classification.rating, 'mixed');
  assert.equal(feed.nextPage, 2);
  const empty = await provider.browse({
    sourceId: `suwayomi:${sourceId}`,
    mode: 'popular',
    page: 2,
  });
  assert.equal(empty.items.length, 0);
  assert.equal(empty.hasMore, true);
  assert.equal(empty.nextPage, 3);
  assert.equal(
    calls.some((c) => /\bmangas\s*\(/.test(c.query)),
    false,
  );
  assert.equal(calls.find((c) => c.query.includes('RemoteFeed')).variables.input.source, sourceId);
});

test('catalog capabilities distinguish declared support, runtime evidence and availability', async () => {
  const provider = await adapter();
  const result = (await provider.catalogs({ limit: 20 })).sources[0];
  assert.equal(result.capabilities.latest, 'unverified');
  assert.equal(result.capabilities.search, 'unverified');
  assert.equal(result.capabilities.resolveLink, 'unsupported');
  assert.equal(result.classification.provenance.sourceField, 'SourceType.contentWarning');
  const unsupported = await adapter(fixtureFetch({ supportsLatest: false }));
  const feed = await unsupported.browse({ sourceId: `suwayomi:${sourceId}`, mode: 'latest' });
  assert.equal(feed.sourceState.state, 'unsupported');
  await assert.rejects(
    provider.resolveLink({
      sourceId: `suwayomi:${sourceId}`,
      url: 'https://example.invalid/series/new',
    }),
    (e) => e.status === 422,
  );
});

test('failed feeds preserve source status and never assert a capability unsupported', async () => {
  const remote = fixtureFetch();
  for (const status of [401, 403, 429]) {
    const provider = await adapter((url, opts) =>
      JSON.parse(opts.body).query.includes('RemoteFeed')
        ? Promise.resolve(new Response('', { status, headers: { 'retry-after': '5' } }))
        : remote(url, opts),
    );
    const feed = await provider.browse({ sourceId: `suwayomi:${sourceId}`, mode: 'latest' });
    assert.equal(feed.sourceState.state, 'unavailable');
    assert.equal(feed.sourceState.status, String(status));
    assert.equal(feed.sourceState.retryAfter, '5');
    assert.equal((await provider.catalogs({})).sources[0].capabilities.latest, 'unverified');
  }
});

test('title keys normalize source-owned absolute and relative URLs and reject foreign ownership', async () => {
  const remote = fixtureFetch();
  const provider = await adapter((url, opts) =>
    JSON.parse(opts.body).query.includes('RemoteFeed')
      ? Promise.resolve(
          Response.json({
            data: {
              fetchSourceManga: {
                mangas: [
                  { ...manga, url: 'https://example.invalid/series/new#top' },
                  { ...manga, id: 8, sourceId: '3' },
                ],
                hasNextPage: false,
              },
            },
          }),
        )
      : remote(url, opts),
  );
  const feed = await provider.browse({ sourceId: `suwayomi:${sourceId}`, mode: 'popular' });
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].upstreamRef.upstreamKey, '/series/new');
});

test('details require a binding and verify source and canonical identity before returning metadata', async () => {
  const ref = { sourceId: `suwayomi:${sourceId}`, upstreamKey: '/series/new', language: 'en' };
  const provider = await adapter(undefined, {
    bindings: { resolveTitle: async () => ({ localMangaId: '7' }) },
  });
  assert.equal((await provider.details(ref)).metadata.title, 'New unindexed title');
  await assert.rejects(
    provider.details({ ...ref, upstreamKey: '/series/other' }),
    (e) => e.status === 409,
  );
  await assert.rejects((await adapter()).details(ref), (e) => e.status === 409);
});

test('a source declaring latest unsupported overrides earlier successful runtime evidence', async () => {
  let supportsLatest = true;
  const provider = await adapter((url, opts) => fixtureFetch({ supportsLatest })(url, opts));
  await provider.browse({ sourceId: `suwayomi:${sourceId}`, mode: 'latest' });
  assert.equal((await provider.catalogs({})).sources[0].capabilities.latest, 'supported');
  supportsLatest = false;
  assert.equal((await provider.catalogs({})).sources[0].capabilities.latest, 'unsupported');
});

test('generic bridge routes are disabled by default and pass only fixed adapter inputs when enabled', async () => {
  const { bridgeHandler } = await import('../services/reader-bridge/server.mjs');
  const key = 'x'.repeat(32);
  const request = (path, body = {}) =>
    new Request(`http://bridge${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  const provider = { extensions: await adapter() };
  assert.equal((await bridgeHandler({ key, provider })(request('/extension/browse'))).status, 404);
  const response = await bridgeHandler({ key, provider, extensionsEnabled: true })(
    request('/extension/browse', { sourceId: `suwayomi:${sourceId}`, mode: 'popular' }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items[0].upstreamRef.upstreamKey, '/series/new');
});
