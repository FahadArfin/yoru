import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Response } from 'miniflare';
import { createRuntime, migrate, sql } from './harness.mjs';
test('cast credits use the shared durable cache across Workers', async () => {
  let calls = 0;
  const id = 'mal-anime-940002';
  const runtime = await createRuntime({
    bindings: { CATALOG_OFFLINE: '0' },
    provider: async (request) => {
      calls++;
      assert.equal(new URL(request.url).pathname, '/v1/anime/940002/characters');
      return Response.json({
        data: [
          {
            character: { mal_id: 1, name: 'Cast character' },
            role: 'Main',
            voice_actors: [{ person: { mal_id: 2, name: 'Cast actor' }, language: 'Japanese' }],
          },
        ],
      });
    },
  });
  try {
    await migrate(runtime);
    const media = {
      id,
      title: 'Cast test',
      category: 'ANIME',
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
    for (const origin of ['a', 'b']) {
      const response = await runtime.dispatchFetch(`http://${origin}.test/api/media/${id}/cast`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).items[0].actors[0].name, 'Cast actor');
    }
    assert.equal(calls, 1);
    assert.equal(
      (await runtime.dispatchFetch('http://a.test/api/media/mal-manga-1/cast')).status,
      400,
    );
  } finally {
    await runtime.dispose();
  }
});
