import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Response } from 'miniflare';
import { createRuntime, migrate, sql } from './harness.mjs';

test('live catalog pages and title metadata survive independent Worker instances and provider outages', async () => {
  let calls = 0;
  let unavailable = false;
  const runtime = await createRuntime({
    bindings: { CATALOG_OFFLINE: '0' },
    provider: async (request) => {
      calls++;
      if (unavailable) return new Response('{}', { status: 503 });
      const url = new URL(request.url);
      assert.equal(url.hostname, 'api.tenrai.org');
      assert.equal(url.pathname, '/v1/anime');
      assert.equal(url.searchParams.get('sfw'), 'true');
      const page = Number(url.searchParams.get('page'));
      return Response.json({
        data: Array.from({ length: 25 }, (_, i) => ({
          mal_id: 930000 + (page - 1) * 25 + i,
          title: `Catalog title ${(page - 1) * 25 + i}`,
          type: 'TV',
          genres: [],
        })),
        pagination: { has_next_page: true, items: { total: 22500 } },
      });
    },
  });
  const get = async (instance, path) => {
    const response = await runtime.dispatchFetch(`http://${instance}.test${path}`);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  try {
    await migrate(runtime);
    const savedDetail = {
      id: 'mal-anime-930000',
      title: 'Saved full title',
      type: 'ANIME',
      genres: [],
      detailed: true,
      metadataFetchedAt: '2026-01-01T00:00:00.000Z',
      relations: [{ relation: 'Sequel', entries: [] }],
      externalLinks: [{ label: 'Official', type: 'official', url: 'https://example.com/title' }],
    };
    await sql(runtime, [
      [
        'INSERT INTO catalog_media(id,payload,fetched_at) VALUES(?,?,?)',
        savedDetail.id,
        JSON.stringify(savedDetail),
        Date.parse(savedDetail.metadataFetchedAt),
      ],
    ]);
    const first = await get('a', '/api/catalog?category=ANIME');
    assert.equal(first.total, 22500);
    assert.equal(first.items.length, 24);
    assert.equal(first.items[0].source, 'MyAnimeList via Tenrai');
    const count = calls;
    const shared = await get('b', '/api/catalog?category=ANIME');
    assert.deepEqual(
      shared.items.map((x) => x.id),
      first.items.map((x) => x.id),
    );
    assert.equal(calls, count, 'Another isolate reuses the durable page without calling providers');
    const preserved = (
      await sql(runtime, [['SELECT payload FROM catalog_media WHERE id=?', savedDetail.id]])
    )[0].results[0];
    assert.deepEqual(JSON.parse(preserved.payload).relations, savedDetail.relations);
    const later = await get('a', '/api/catalog?category=ANIME&page=101');
    assert.equal(later.page, 101);
    assert.equal(later.items[0].id, 'mal-anime-932400');
    unavailable = true;
    const detail = await get('b', '/api/media/mal-anime-932400');
    assert.equal(detail.id, 'mal-anime-932400');
    // Expire a page that b has not loaded; it must retain this exact page after an outage.
    await sql(runtime, [['UPDATE catalog_pages SET fetched_at=0']]);
    const stale = await get('b', '/api/catalog?category=ANIME&page=101');
    assert.equal(stale.catalogState, 'stale');
    assert.equal(stale.providerUnavailable, true);
    assert.equal(stale.total, 22500);
    assert.deepEqual(
      stale.items.map((x) => x.id),
      later.items.map((x) => x.id),
    );
  } finally {
    await runtime.dispose();
  }
});
