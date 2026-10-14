import test from 'node:test';
import assert from 'node:assert/strict';
import { Response } from 'miniflare';
import { createRuntime, migrate } from './harness.mjs';
test('homepage shares cached releases and popularity across Workers without leaking the token', async () => {
  let calls = 0;
  const runtime = await createRuntime({
    bindings: { ANIMESCHEDULE_API_TOKEN: 'private-home-token' },
    provider: async (request) => {
      calls++;
      const url = new URL(request.url);
      assert.equal(url.hostname, 'animeschedule.net');
      assert.equal(request.headers.get('Authorization'), 'Bearer private-home-token');
      const anime = {
        route: 'one-piece',
        title: 'One Piece',
        websites: { mal: 'myanimelist.net/anime/21' },
        stats: { trackedCount: 100 },
      };
      return Response.json(
        url.pathname.includes('timetables')
          ? [
              {
                route: 'one-piece',
                title: 'One Piece',
                episodeDate: new Date(Date.now() - 1000).toISOString(),
                episodeNumber: 10,
                airType: 'sub',
              },
            ]
          : { anime: [anime] },
      );
    },
  });
  try {
    await migrate(runtime);
    const first = await (await runtime.dispatchFetch('http://a.test/api/home?language=sub')).json();
    assert.equal(first.hot[0].id, 'mal-anime-21');
    assert.equal(first.releases[0].media.id, 'mal-anime-21');
    assert.equal(first.releases[0].episode, 10);
    assert.equal(calls, 4);
    const second = await (
      await runtime.dispatchFetch('http://b.test/api/home?language=sub')
    ).json();
    assert.deepEqual(first, second);
    assert.equal(calls, 4);
    assert.equal(JSON.stringify(second).includes('private-home-token'), false);
    const sidebar = await (await runtime.dispatchFetch('http://a.test/api/home/sidebar')).json();
    assert.equal(sidebar.upcoming[0].id, 'mal-anime-21');
    assert.deepEqual(sidebar.mostViewed, []);
    assert.equal(sidebar.stale, false);
    assert.equal(calls, 5);
    const sharedSidebar = await (
      await runtime.dispatchFetch('http://b.test/api/home/sidebar')
    ).json();
    assert.deepEqual(sidebar, sharedSidebar);
    assert.equal(calls, 5);
    assert.equal(JSON.stringify(sharedSidebar).includes('private-home-token'), false);
  } finally {
    await runtime.dispose();
  }
});
