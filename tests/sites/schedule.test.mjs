import test from 'node:test';
import assert from 'node:assert/strict';
import { Response } from 'miniflare';
import { createRuntime, migrate, sql } from './harness.mjs';
test('airing timetable persists across Workers and preserves last good data on provider failure', async () => {
  let calls = 0,
    fail = false;
  const runtime = await createRuntime({
    bindings: { ANIMESCHEDULE_API_TOKEN: 'private-test-token' },
    provider: async (request) => {
      assert.equal(new URL(request.url).hostname, 'animeschedule.net');
      assert.equal(request.headers.get('Authorization'), 'Bearer private-test-token');
      calls++;
      return fail
        ? new Response('', { status: 503 })
        : Response.json([
            {
              route: 'test-anime',
              title: 'Test anime',
              episodeDate: new Date().toISOString(),
              episodeNumber: 1,
              airType: 'raw',
            },
          ]);
    },
  });
  try {
    await migrate(runtime);
    const first = await (await runtime.dispatchFetch('http://a.test/api/calendar')).json();
    assert.equal(first.state, 'ready');
    assert.ok(first.items.length);
    assert.equal(calls, 3);
    const second = await (await runtime.dispatchFetch('http://b.test/api/calendar')).json();
    assert.equal(second.state, 'ready');
    assert.equal(calls, 3);
    await sql(runtime, [
      [`UPDATE catalog_pages SET fetched_at=0 WHERE query_key LIKE 'lease:airing:%'`],
      [
        `UPDATE catalog_pages SET payload=json_set(payload,'$.fetchedAt',?),fetched_at=? WHERE query_key LIKE 'airing:%'`,
        Date.now() - 7200000,
        Date.now() - 7200000,
      ],
    ]);
    fail = true;
    const stale = await (await runtime.dispatchFetch('http://b.test/api/calendar')).json();
    assert.equal(stale.state, 'stale');
    assert.ok(stale.items.length);
    assert.equal(stale.providerUnavailable, true);
    assert.equal(calls, 6);
    await Promise.all(
      Array.from({ length: 41 }, (_, index) =>
        runtime.dispatchFetch(`http://${index % 2 ? 'a' : 'b'}.test/api/calendar`),
      ),
    );
    assert.equal(calls, 6, 'Shared outage lease prevents another provider burst across Workers');
    assert.equal(JSON.stringify(stale).includes('private-test-token'), false);
  } finally {
    await runtime.dispose();
  }
});
