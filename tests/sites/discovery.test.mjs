import test from 'node:test';
import assert from 'node:assert/strict';
import { Response } from 'miniflare';
import { createRuntime, migrate, sql } from './harness.mjs';

test('manga discoveries cache their exact MAL identities and metadata across Workers', async () => {
  let calls = 0;
  const runtime = await createRuntime({
    bindings: { CATALOG_OFFLINE: '0' },
    provider: async (request) => {
      calls++;
      assert.equal(new URL(request.url).hostname, 'kitsu.io');
      return Response.json({
        data: [0, 1].map((index) => ({
          id: String(9911 + index),
          type: 'manga',
          attributes: {
            canonicalTitle: 'A newly discovered manga',
            subtype: 'manga',
            status: 'current',
            startDate: '2026-09-01',
            userCount: 12,
            posterImage: { large: 'https://media.kitsu.app/poster.jpg' },
          },
          relationships: { mappings: { data: [{ id: String(9911 + index), type: 'mappings' }] } },
        })),
        included: [0, 1].map((index) => ({
          type: 'mappings',
          id: String(9911 + index),
          attributes: { externalSite: 'myanimelist/manga', externalId: String(999111 + index) },
        })),
      });
    },
  });
  try {
    await migrate(runtime);
    const detail = {
      id: 'mal-manga-999111',
      title: 'An enriched title',
      detailed: true,
      category: 'MANGA',
      metadataFetchedAt: new Date().toISOString(),
      authors: ['Author'],
      relations: [{ relation: 'Sequel' }],
      externalLinks: [{ type: 'reading', url: 'https://www.viz.com/read' }],
    };
    await sql(runtime, [
      [
        'INSERT INTO catalog_media(id,payload,fetched_at) VALUES(?,?,?)',
        detail.id,
        JSON.stringify(detail),
        Date.now() - 1000,
      ],
    ]);
    const first = await (
      await runtime.dispatchFetch('https://a.test/api/manga/discovery?mode=new')
    ).json();
    assert.equal(first.state, 'ready');
    assert.equal(first.items[0].id, 'mal-manga-999111');
    const second = await (
      await runtime.dispatchFetch('https://b.test/api/manga/discovery?mode=new')
    ).json();
    assert.deepEqual(second, first);
    assert.equal(calls, 1);
    const saved = await sql(runtime, [
      ['SELECT payload FROM catalog_media WHERE id=?', 'mal-manga-999111'],
      ['SELECT payload FROM catalog_media WHERE id=?', 'mal-manga-999112'],
    ]);
    assert.deepEqual(JSON.parse(saved[0].results[0].payload), detail);
    assert.equal(JSON.parse(saved[1].results[0].payload).detailed, false);
    const title = await (
      await runtime.dispatchFetch('https://b.test/api/media/mal-manga-999111')
    ).json();
    assert.deepEqual(title.externalLinks, detail.externalLinks);
  } finally {
    await runtime.dispose();
  }
});

test('D1 manga readers are shared across Workers and isolated from anime rankings', async () => {
  const runtime = await createRuntime();
  try {
    await migrate(runtime);
    const post = (host, cookie = '', id = 'mal-manga-21', origin = `https://${host}.test`) =>
      runtime.dispatchFetch(`https://${host}.test/api/media/${id}/read-view`, {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: '{}',
      });
    const first = await post('a');
    assert.equal(first.status, 200);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    assert.match(first.headers.get('set-cookie'), /HttpOnly/);
    await Promise.all([post('b', cookie), post('a', cookie)]);
    const result = await (
      await runtime.dispatchFetch('https://b.test/api/manga/discovery?mode=trending')
    ).json();
    assert.equal(result.items[0].id, 'mal-manga-21');
    assert.equal(result.items[0].viewers, 1);
    assert.equal((await post('a', cookie, 'mal-anime-21')).status, 400);
    assert.equal((await post('a', cookie, 'mal-manga-21', 'https://evil.test')).status, 403);
    assert.deepEqual(
      (
        await (
          await runtime.dispatchFetch('https://a.test/api/home/discovery?mode=trending')
        ).json()
      ).items,
      [],
    );
    assert.equal(
      (await (await runtime.dispatchFetch('https://a.test/api/manga/discovery?mode=new')).json())
        .state,
      'unavailable',
    );
  } finally {
    await runtime.dispose();
  }
});

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
