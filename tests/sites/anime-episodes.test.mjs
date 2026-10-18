import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Response } from 'miniflare';
import { createRuntime, migrate, sql } from './harness.mjs';

test('episode metadata and latest resolution share a durable cache between Workers', async () => {
  let calls = 0;
  const id = 'mal-anime-940001';
  const runtime = await createRuntime({
    bindings: { CATALOG_OFFLINE: '0' },
    provider: async (request) => {
      calls++;
      assert.equal(new URL(request.url).pathname, '/v1/anime/940001/episodes');
      return Response.json({
        data: [
          { mal_id: 3, title: 'Released', aired: '2020-01-01' },
          { mal_id: 4, title: 'Future', aired: '2099-01-01' },
        ],
        pagination: { last_visible_page: 1, has_next_page: false },
      });
    },
  });
  try {
    await migrate(runtime);
    const media = {
      id,
      title: 'Episode test',
      category: 'ANIME',
      status: 'Currently Airing',
      episodes: 12,
      detailed: true,
      isAdult: false,
      metadataFetchedAt: new Date().toISOString(),
    };
    await sql(runtime, [
      [
        'INSERT INTO catalog_media(id,payload,fetched_at) VALUES(?,?,?)',
        id,
        JSON.stringify(media),
        Date.now(),
      ],
    ]);
    const first = await runtime.dispatchFetch(`http://a.test/api/media/${id}/episodes?page=1`);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).items[0].title, 'Released');
    const latest = await runtime.dispatchFetch(`http://b.test/api/media/${id}/episodes?latest=1`);
    assert.equal(latest.status, 200);
    assert.equal((await latest.json()).latest, 3);
    assert.equal(calls, 1);
    const invalid = await runtime.dispatchFetch('http://a.test/api/media/mal-manga-21/episodes');
    assert.equal(invalid.status, 400);
  } finally {
    await runtime.dispose();
  }
});
