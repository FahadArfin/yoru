import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalDeliveryContract } from './reader-final-delivery-contract.mjs';

export const inventoryRating = (rating = 'safe') => ({
  rating,
  provenance: {
    sourceField: 'source.contentWarning',
    value: rating,
    checkedAt: '2026-10-19T00:00:00Z',
  },
});
export const inventorySource = (id) => ({
  id: `suwayomi:${id}`,
  integration: 'suwayomi',
  upstreamSourceId: String(id),
  providerKey: 'MangaDex',
  language: 'en',
  classification: inventoryRating(),
  capabilities: Object.fromEntries(
    ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map((k) => [
      k,
      'supported',
    ]),
  ),
  bridgeInstance: 'fixture',
});
export function catalogProvider() {
  const state = {
    rating: 'safe',
    mode: 'ready',
    calls: [],
    hold: null,
    sources: Array.from({ length: 601 }, (_, i) => inventorySource(i + 1)),
  };
  const respond = async (request, ResponseClass = Response) => {
    const url = new URL(request.url),
      input = await request.json();
    state.calls.push(url.pathname);
    if (state.mode === 'rate-limited')
      return new ResponseClass('PRIVATE https://upstream.invalid', {
        status: 429,
        headers: { 'retry-after': '3' },
      });
    if (url.pathname === '/catalogs')
      return ResponseClass.json({
        sources: state.sources.map((s) => ({
          id: s.upstreamSourceId,
          name: s.providerKey,
          language: s.language,
        })),
      });
    if (url.pathname === '/extension/catalogs') {
      const start = Number(input.cursor || 0),
        limit = input.limit || 100;
      return ResponseClass.json({
        sources: state.sources
          .slice(start, start + limit)
          .map((s) => ({ ...s, classification: inventoryRating(state.rating) })),
        nextCursor: start + limit < state.sources.length ? String(start + limit) : null,
      });
    }
    const s = {
      ...state.sources.find((s) => s.id === (input.sourceId || input.titleRef?.sourceId)),
      classification: inventoryRating(state.rating),
    };
    const title = {
      sourceRef: s,
      upstreamRef: { sourceId: s.id, upstreamKey: '/title', language: 'en' },
      classification: inventoryRating(state.rating),
      metadata: { title: 'Cached fixture', cover: 'https://private.invalid/image' },
    };
    const edition = {
      sourceRef: s,
      upstreamRef: { title: title.upstreamRef, upstreamKey: '/chapter/1' },
      metadata: { number: '1', pageCount: 1, title: 'Fresh chapter' },
    };
    if (state.hold?.operation === url.pathname) await state.hold.wait();
    if (url.pathname === '/extension/chapters')
      return ResponseClass.json({
        items: [
          edition,
          { ...edition, upstreamRef: { ...edition.upstreamRef, upstreamKey: '/chapter/2' } },
        ],
        hasMore: false,
      });
    if (url.pathname === '/extension/chapter') return ResponseClass.json(edition);
    if (url.pathname === '/extension/reader') return ResponseClass.json({ edition, pages: [0] });
    if (url.pathname === '/extension/browse')
      return ResponseClass.json({ items: [title], nextPage: 2, hasMore: true });
    if (url.pathname === '/extension/details' || url.pathname === '/extension/resolve')
      return ResponseClass.json(title);
    if (['/extension/cover', '/extension/page'].includes(url.pathname))
      return new ResponseClass(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'content-type': 'image/png' },
      });
    return new ResponseClass('PRIVATE', { status: 503 });
  };
  return { state, respond };
}
export function extensionCatalogContract(label, fixture) {
  test(`${label}: catalog paging, feed filtering, ownership and public aliases share one contract`, async () => {
    const f = await fixture();
    try {
      let response = await f.request('/api/reader/catalogs');
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).sources.length,
        601,
        'legacy Settings must not silently truncate at 500',
      );
      let cursor = null,
        total = 0;
      do {
        response = await f.request(
          '/api/reader/catalogs?limit=100' + (cursor ? `&cursor=${cursor}` : ''),
        );
        assert.equal(response.status, 200);
        const page = await response.json();
        total += page.sources.length;
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(total, 601);
      response = await f.request(
        '/api/reader/browse?integration=extensions&source=suwayomi:1&limit=2',
      );
      assert.equal(response.status, 200);
      const feed = await response.json();
      assert.deepEqual(
        feed.updates,
        [],
        'public runtimes retain the additive merge-update protocol',
      );
      assert.equal(feed.items.length, 1);
      assert.equal(feed.total, null);
      const media = feed.items[0];
      assert.match(media.id, /^ext-manga-/);
      assert.match(media.cover, /destination=yoru/);
      assert.doesNotMatch(JSON.stringify(feed), /private\.invalid/);
      assert.equal((await f.request(`/api/reader/media/${media.id}?destination=yoru`)).status, 200);
      assert.equal(
        (await f.request(`/api/reader/media/${media.id}/cover?destination=yoru`)).status,
        200,
      );
      await finalDeliveryContract(f, media);
      const before = f.provider.state.calls.length;
      response = await f.request('/api/reader/suggestions?integration=extensions&q=Cached');
      assert.equal(response.status, 200);
      assert.equal((await response.json()).items.length, 1);
      assert.equal(f.provider.state.calls.length, before, 'suggestions must not fan out');
      response = await f.request(
        '/api/reader/browse?integration=extensions&source=suwayomi:1&limit=2&cursor=' +
          feed.nextCursor +
          '&destination=ara-ara',
      );
      assert.equal(response.status, 409);
      assert.equal((await response.json()).restartRequired, true);
      response = await f.request('/api/reader/discovery?integration=extensions&source=suwayomi:1');
      assert.equal(response.status, 200);
      f.provider.state.rating = 'mixed';
      response = await f.request('/api/reader/discovery?integration=extensions&source=suwayomi:1');
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).items, []);
      response = await f.request('/api/reader/suggestions?integration=extensions&q=Cached');
      assert.deepEqual((await response.json()).items, []);
      f.provider.state.rating = 'safe';
      response = await f.request('/api/reader/resolve-link', {
        method: 'POST',
        body: { source: 'suwayomi:1', url: 'https://provider.invalid/title' },
      });
      assert.equal(response.status, 200);
      const guest = await f.guest({ overrides: { MangaDex: { yoru: false } } });
      response = await f.request('/api/reader/discovery?integration=extensions&source=suwayomi:1', {
        cookie: guest,
      });
      assert.deepEqual((await response.json()).items, []);
      if (f.account) {
        const account = await f.account();
        response = await f.request(
          '/api/reader/discovery?integration=extensions&source=suwayomi:1',
          { cookie: account },
        );
        assert.deepEqual((await response.json()).items, []);
      }
      f.provider.state.mode = 'rate-limited';
      response = await f.request('/api/reader/catalogs?limit=100');
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '3');
      assert.doesNotMatch(await response.text(), /upstream\.invalid|PRIVATE/);
      await f.expireBridge?.();
      if (f.expireBridge)
        assert.equal((await f.request('/api/reader/catalogs?limit=100')).status, 503);
    } finally {
      await f.close();
    }
  });
}
