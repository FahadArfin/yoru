import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Response } from 'miniflare';
import { createRuntime, migrate, sql } from './harness.mjs';

test('Sites connects the private reader across Workers without exposing its credential or admin API', async () => {
  const key = 'test-reader-bridge-key-more-than-32-characters';
  const media = {
    id: 'mal-manga-21',
    category: 'MANGA',
    title: 'Death Note',
    genres: [],
    fetchedAt: Date.now(),
    detailsFetchedAt: Date.now(),
  };
  const chapter = {
    id: 'sw-weebcentral-8-90',
    number: '1',
    title: 'Beginning',
    language: 'en',
    groups: [],
    pages: 2,
    native: true,
    source: 'weebcentral',
  };
  let wrongTitle = false,
    unavailable = false,
    redirect = false,
    calls = 0;
  const runtime = await createRuntime({
    bindings: { CATALOG_OFFLINE: '0', READER_BRIDGE_KEY: key },
    provider: async (request) => {
      if (new URL(request.url).hostname === 'api.tenrai.org')
        return new Response('No fixture', { status: 503 });
      assert.equal(new URL(request.url).hostname, 'fixture.trycloudflare.com');
      assert.equal(request.headers.get('authorization'), `Bearer ${key}`);
      assert.equal(request.method, 'POST');
      const body = await request.json();
      assert.equal(body.media.id, media.id);
      calls++;
      if (redirect)
        return new Response(null, { status: 302, headers: { location: 'https://attacker.test' } });
      if (unavailable) return new Response('offline', { status: 503 });
      const path = new URL(request.url).pathname;
      if (path === '/page')
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'content-type': 'image/png', 'x-yoru-cache': 'hit' },
        });
      return Response.json({
        mediaId: wrongTitle ? 'mal-manga-99' : media.id,
        ...(path === '/sources'
          ? {
              sources: [
                { id: 'weebcentral', name: 'Weeb Central', native: true, languages: ['en'] },
              ],
            }
          : path === '/chapters'
            ? { items: [chapter], total: 1, nextOffset: null, languages: ['en'], state: 'ready' }
            : { chapter: { ...chapter, pages: path === '/reader' ? [0, 1] : 2 } }),
      });
    },
  });
  try {
    await migrate(runtime);
    await sql(runtime, [
      [
        'INSERT INTO catalog_media(id,payload,fetched_at) VALUES(?,?,?)',
        media.id,
        JSON.stringify(media),
        Date.now(),
      ],
    ]);
    const register = (token, url = 'https://fixture.trycloudflare.com') =>
      runtime.dispatchFetch('http://a.test/api/reader-bridge/register', {
        method: 'POST',
        headers: {
          origin: 'http://a.test',
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url }),
      });
    assert.equal((await register('wrong')).status, 401);
    assert.equal((await register(key, 'https://attacker.test')).status, 400);
    assert.equal((await register(key)).status, 200);
    const get = (path) => runtime.dispatchFetch(`http://b.test/api/media/${media.id}${path}`);
    const sources = await (await get('/reading-sources')).json();
    assert.equal(sources.state, 'ready');
    assert.equal(sources.sources[0].id, 'weebcentral');
    assert.ok(!JSON.stringify(sources).includes(key));
    const catalog = await (await get('/chapters?source=weebcentral')).json();
    assert.equal(catalog.items[0].readUrl, `/read/${media.id}/1?chapter=${chapter.id}&language=en`);
    const manifest = await (await get(`/reader/${chapter.id}`)).json();
    assert.equal(manifest.pages[1].url, `/api/media/${media.id}/reader/${chapter.id}/page/1`);
    assert.ok(!JSON.stringify(manifest).includes('trycloudflare'));
    const page = await get(`/reader/${chapter.id}/page/0`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-yoru-cache'), 'hit');
    assert.equal(page.headers.get('content-type'), 'image/png');
    assert.equal((await page.arrayBuffer()).byteLength, 4);
    assert.equal((await get(`/reader/${chapter.id}/page/500`)).status, 400);
    redirect = true;
    assert.equal((await get(`/reader/${chapter.id}`)).status, 503);
    redirect = false;
    wrongTitle = true;
    assert.equal((await get(`/reader/${chapter.id}`)).status, 502);
    wrongTitle = false;
    unavailable = true;
    assert.equal((await get(`/reader/${chapter.id}`)).status, 503);
    assert.equal((await (await get('/reading-sources')).json()).state, 'offline');
    await sql(runtime, [
      [
        'UPDATE catalog_pages SET payload=? WHERE query_key=?',
        JSON.stringify({ url: 'https://fixture.trycloudflare.com', expiresAt: 0 }),
        'reader-bridge:v1:endpoint',
      ],
    ]);
    const before = calls;
    assert.equal((await get(`/reader/${chapter.id}`)).status, 503);
    assert.equal(calls, before, 'expired registration is never contacted');
  } finally {
    await runtime.dispose();
  }
});
