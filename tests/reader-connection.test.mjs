import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bridgeHandler } from '../services/reader-bridge/server.mjs';
import { getReaderCatalogs } from '../server/reading-sources.js';

test('legacy classification is used only when that field is unsupported, never after auth failure', async () => {
  const { discoverCatalogs } = await import('../shared/reader-connection.js');
  let calls = 0;
  const result = await discoverCatalogs('https://reader.example', {
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? Response.json({
            errors: [{ message: 'Cannot query field "contentWarning" on type "SourceType".' }],
          })
        : Response.json({
            data: {
              sources: {
                nodes: [
                  { id: '1', name: 'Legacy', isNsfw: false },
                  { id: '2', name: 'Unknown' },
                ],
              },
            },
          });
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(
    result.sources.map((s) => s.id),
    ['1', '2'],
  );
  calls = 0;
  await assert.rejects(
    discoverCatalogs('https://reader.example', {
      fetchImpl: async () => {
        calls++;
        return new Response('', { status: 403 });
      },
    }),
    /sign-in/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    discoverCatalogs('https://reader.example', {
      fetchImpl: async () => new Response('x'.repeat(1024 ** 2 + 1)),
    }),
    /too large/,
  );
});

test('hosted discovery requires bridge authentication and exposes neither host credentials nor indexed titles', async () => {
  const key = 'a'.repeat(32);
  const handler = bridgeHandler({
    key,
    provider: {
      catalogs: async () => ({
        sources: [{ id: '1', name: 'Catalog', language: 'en', password: 'secret' }],
      }),
    },
  });
  assert.equal(
    (await handler(new Request('http://bridge/catalogs', { method: 'POST', body: '{}' }))).status,
    401,
  );
  const result = await getReaderCatalogs({
    bridgeKey: key,
    bridgeUrl: 'http://bridge',
    fetchImpl: (url, options) => handler(new Request(url, options)),
  });
  assert.deepEqual(result, { sources: [{ id: '1', name: 'Catalog', language: 'en' }] });
  assert.equal(
    (
      await handler(
        new Request('http://bridge/catalog', {
          method: 'POST',
          body: '{}',
          headers: { authorization: `Bearer ${key}` },
        }),
      )
    ).status,
    404,
  );
  await assert.rejects(getReaderCatalogs({ offline: true }), /offline/);
});

test('connection accepts server and GraphQL addresses without changing the host or prefix', async () => {
  const { normalizeServerUrl } = await import('../shared/reader-connection.js');
  assert.equal(normalizeServerUrl(' reader.example/ '), 'https://reader.example');
  assert.equal(
    normalizeServerUrl('https://reader.example/books/api/graphql/'),
    'https://reader.example/books',
  );
  assert.equal(normalizeServerUrl('http://localhost:4567/'), 'http://localhost:4567');
  for (const value of [
    'javascript:alert(1)',
    'https://user:secret@example.com',
    'https://example.com/?token=secret',
    'https://raw.githubusercontent.com/a/b/repo/index.min.json',
  ]) {
    assert.throws(() => normalizeServerUrl(value));
  }
});

test('discovery lists installed online catalogs of every classification and excludes local files', async () => {
  const { discoverCatalogs } = await import('../shared/reader-connection.js');
  const sources = [
    { id: '1', name: 'Safe catalog', lang: 'en', isNsfw: false, contentWarning: 'SAFE' },
    { id: '2', name: 'Explicit catalog', lang: 'en', isNsfw: true, contentWarning: 'NSFW' },
    { id: '3', name: 'Mixed catalog', lang: 'en', isNsfw: false, contentWarning: 'MIXED' },
    { id: '4', name: 'Unknown catalog', lang: 'en' },
    { id: '0', name: 'Local files', lang: 'en', isNsfw: false, contentWarning: 'SAFE' },
  ];
  const result = await discoverCatalogs('https://reader.example', {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://reader.example/api/graphql');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      return Response.json({ data: { sources: { nodes: sources } } });
    },
  });
  assert.deepEqual(
    result.sources.map((x) => x.id),
    ['1', '2', '3', '4'],
  );
  assert.equal(result.excluded, 1);
  await assert.rejects(
    discoverCatalogs('https://reader.example', {
      fetchImpl: async () => Response.json({ hello: true }),
    }),
    /compatible/,
  );
  await assert.rejects(
    discoverCatalogs('https://reader.example', {
      fetchImpl: async () => new Response('', { status: 401 }),
    }),
    /sign-in/,
  );
});

test('catalog browsing revalidates the selected source and rejects titles from another source', async () => {
  const { browseCatalog } = await import('../shared/reader-connection.js');
  const sources = [
    { id: '1', name: 'Safe catalog', lang: 'en', isNsfw: false, contentWarning: 'SAFE' },
  ];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.query.includes('YoruSources'))
      return Response.json({ data: { sources: { nodes: sources } } });
    assert.equal(body.variables.source, '1');
    return Response.json({
      data: {
        mangas: {
          nodes: [
            { id: 7, sourceId: '1', title: 'A story', genre: ['Adventure'] },
            { id: 8, sourceId: '2', title: 'Wrong source', genre: [] },
            { id: 9, sourceId: '1', title: 'Excluded title', genre: ['Hentai'] },
          ],
          pageInfo: { hasNextPage: false },
        },
      },
    });
  };
  const result = await browseCatalog('https://reader.example', '1', '', 0, { fetchImpl });
  assert.deepEqual(
    result.items.map((x) => x.title),
    ['A story', 'Excluded title'],
  );
  await assert.rejects(
    browseCatalog('https://reader.example', '2', '', 0, { fetchImpl }),
    /available/,
  );
});

test('custom server discovery preserves signed 64-bit IDs, classification and explicit indexed-only browsing', async () => {
  const { discoverCatalogs, browseCatalog } = await import('../shared/reader-connection.js');
  const fetchImpl = async (_url, opts) =>
    Response.json({
      data: JSON.parse(opts.body).query.includes('YoruSources')
        ? {
            sources: {
              nodes: [
                {
                  id: '-9223372036854775808',
                  name: 'Mixed',
                  lang: 'ja',
                  contentWarning: 'MIXED',
                  supportsLatest: true,
                },
                { id: '9223372036854775808', name: 'Overflow' },
              ],
            },
          }
        : { mangas: { nodes: [], pageInfo: { hasNextPage: true } } },
    });
  const result = await discoverCatalogs('https://fixture', { fetchImpl, now: () => 1000 });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].id, '-9223372036854775808');
  assert.equal(result.sources[0].classification.rating, 'mixed');
  assert.equal(result.sources[0].capabilities.latest, 'unverified');
  const page = await browseCatalog('https://fixture', '-9223372036854775808', '', 0, { fetchImpl });
  assert.equal(page.indexedOnly, true);
  assert.equal(page.hasNextPage, true);
});

test('custom server failures preserve status and retry timing', async () => {
  const { discoverCatalogs } = await import('../shared/reader-connection.js');
  await assert.rejects(
    discoverCatalogs('https://fixture', {
      now: () => 1000,
      fetchImpl: async () => new Response('', { status: 429, headers: { 'retry-after': '5' } }),
    }),
    (e) => e.status === 429 && e.retryAfter === '5' && e.retryAt === '1970-01-01T00:00:06.000Z',
  );
});
