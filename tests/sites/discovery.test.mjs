import test from 'node:test';
import assert from 'node:assert/strict';
import { Response } from 'miniflare';
import { createRuntime, migrate, sql } from './harness.mjs';

test('D1 counts unique watch visitors across Workers and rejects invalid or cross-origin writes', async () => {
  const runtime = await createRuntime();
  try {
    await migrate(runtime);
    const post = (host, cookie = '', id = 'mal-anime-21', origin = `https://${host}.test`) =>
      runtime.dispatchFetch(`https://${host}.test/api/media/${id}/view`, {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: '{}',
      });
    const first = await post('a');
    assert.equal(first.status, 200);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    assert.match(first.headers.get('set-cookie'), /HttpOnly/);
    assert.match(first.headers.get('set-cookie'), /Secure/);
    await Promise.all([post('a', cookie), post('b', cookie), post('b')]);
    const result = await (
      await runtime.dispatchFetch('https://a.test/api/home/discovery?mode=trending')
    ).json();
    assert.equal(result.items[0].id, 'mal-anime-21');
    assert.equal(result.items[0].viewers, 2);
    assert.equal(JSON.stringify(result).includes('visitor_hash'), false);
    assert.equal((await post('a', cookie, 'mal-manga-21')).status, 400);
    assert.equal((await post('a', cookie, 'mal-anime-99999999')).status, 404);
    assert.equal((await post('a', cookie, 'mal-anime-21', 'https://evil.test')).status, 403);
    await sql(runtime, [['UPDATE watch_views SET last_seen=?', Date.now() - 8 * 86400000]]);
    assert.deepEqual(
      (
        await (
          await runtime.dispatchFetch('https://b.test/api/home/discovery?mode=trending')
        ).json()
      ).items,
      [],
    );
  } finally {
    await runtime.dispose();
  }
});

test('popular rankings use the shared D1 cache without exposing the provider credential', async () => {
  let calls = 0;
  const runtime = await createRuntime({
    bindings: { ANIMESCHEDULE_API_TOKEN: 'private-popular-token' },
    provider: async (request) => {
      calls++;
      const url = new URL(request.url);
      assert.equal(url.hostname, 'animeschedule.net');
      const year = new Date().getUTCFullYear() - 1;
      assert.equal(url.searchParams.get('years'), String(year));
      return Response.json({
        totalAmount: 1,
        anime: [
          {
            route: 'one-piece',
            title: 'One Piece',
            premier: `${year}-05-01T00:00:00Z`,
            websites: { mal: 'myanimelist.net/anime/21' },
          },
        ],
      });
    },
  });
  try {
    await migrate(runtime);
    const first = await (
      await runtime.dispatchFetch('https://a.test/api/home/discovery?mode=popular&period=year')
    ).json();
    const second = await (
      await runtime.dispatchFetch('https://b.test/api/home/discovery?mode=popular&period=year')
    ).json();
    assert.equal(first.items[0].id, 'mal-anime-21');
    assert.deepEqual(second, first);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(first).includes('private-popular-token'), false);
  } finally {
    await runtime.dispose();
  }
});
