import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExternalCatalogStore } from '../server/external-catalog-store.js';
import { alternativeSource } from './reader-alternatives-fixture.mjs';
export function alternativesProvider() {
  const state = { sources: [], calls: [], failure: false };
  state.respond = async (request, ResponseClass = Response) => {
    const body = await request.json(),
      path = new URL(request.url).pathname;
    state.calls.push({ path, body });
    if (state.failure) return new ResponseClass('SECRET_ORIGINAL PRIVATE', { status: 503 });
    if (path === '/extension/catalogs') {
      const offset = Number(body.cursor || 0),
        limit = body.limit || 100;
      return ResponseClass.json({
        sources: state.sources.slice(offset, offset + limit),
        nextCursor: offset + limit < state.sources.length ? String(offset + limit) : null,
      });
    }
    if (path === '/extension/browse')
      return ResponseClass.json({
        items: [],
        nextPage: null,
        hasMore: false,
        sourceState: { state: 'empty', status: 200 },
      });
    return new ResponseClass('SECRET_ORIGINAL PRIVATE', { status: 500 });
  };
  return state;
}
export function readerAlternativesHttpContract(label, createFixture) {
  test(`${label}: public alternatives recover a single eligible exact owner without denied original bytes and advance scoped bounded proof`, async () => {
    const f = await createFixture();
    try {
      const store = createExternalCatalogStore(f.db),
        originalSource = alternativeSource('1', 'MangaDex'),
        targetSource = alternativeSource('-9223372036854775808');
      const add = (s, key) =>
        store.rememberTitle({
          sourceRef: s,
          upstreamRef: { sourceId: s.id, upstreamKey: key, language: s.language },
          classification: s.classification,
          metadata: { title: 'SECRET_ORIGINAL', cover: 'https://private.invalid/SECRET_ORIGINAL' },
        });
      const original = await add(originalSource, '/SECRET_ORIGINAL'),
        target = await add(targetSource, '/TARGET');
      await store.addEquivalence(original.id, target.id, {
        kind: 'trusted-mapping',
        reference: 'reviewed-fixture',
      });
      f.provider.sources = [originalSource, targetSource];
      await f.select({ overrides: { MangaDex: { yoru: false } } });
      assert.equal(
        (await f.request(`/api/reader/media/${original.id}?destination=yoru`)).status,
        404,
      );
      assert.equal(
        (await f.request(`/api/reader/media/${original.id}/cover?destination=yoru`)).status,
        404,
      );
      const path = `/api/reader/media/${original.id}/alternatives?destination=yoru`;
      let response = await f.request(path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      let result = await response.json();
      assert.equal(result.choices.length, 1);
      assert.equal(result.choices[0].mediaId, target.id);
      assert.equal(result.choices[0].sourceRef.id, targetSource.id);
      assert.equal(result.choices[0].state, 'unverified');
      assert.doesNotMatch(
        JSON.stringify(result),
        /SECRET_ORIGINAL|private.invalid|title|cover|pageCount|editionId/,
      );
      assert.ok(!JSON.stringify(result).includes(original.id));
      assert.ok(f.provider.calls.every((c) => c.path === '/extension/catalogs'));
      f.provider.sources = [
        targetSource,
        ...Array.from({ length: 400 }, (_, i) =>
          alternativeSource(String(i + 10), 'Unknown provider'),
        ),
      ];
      response = await f.request(path);
      result = await response.json();
      assert.equal(result.choices[0].mediaId, target.id);
      assert.equal(result.incomplete, true);
      response = await f.request(`${path}&cursor=${result.nextCursor}`);
      assert.equal(response.status, 200);
      result = await response.json();
      assert.deepEqual(result.choices, []);
      assert.equal(result.incomplete, false);
      assert.equal(result.nextCursor, null);
      const adult = await add(alternativeSource('3', 'MangaDex', 'adult'), '/ADULT');
      const unavailable = [];
      for (const id of [adult.id, `ext-manga-${'f'.repeat(32)}`, 'bad']) {
        response = await f.request(`/api/reader/media/${id}/alternatives?destination=yoru`);
        assert.equal(response.status, 404);
        unavailable.push(await response.json());
      }
      assert.deepEqual(unavailable[0], unavailable[1]);
      assert.deepEqual(unavailable[1], unavailable[2]);
      f.provider.sources = [
        ...Array.from({ length: 405 }, (_, i) =>
          alternativeSource(String(i + 10), 'Unknown provider'),
        ),
        targetSource,
      ];
      f.provider.calls = [];
      response = await f.request(path);
      assert.equal(response.status, 200);
      result = await response.json();
      assert.deepEqual(result.choices, []);
      assert.equal(result.incomplete, true);
      assert.ok(result.nextCursor);
      assert.equal(f.provider.calls.length, 4);
      assert.equal(
        (await f.request(`${path}&cursor=${result.nextCursor}`, { otherGuest: true })).status,
        409,
      );
      assert.equal(
        (
          await f.request(
            `${path.replace('destination=yoru', 'destination=ara-ara')}&cursor=${result.nextCursor}`,
          )
        ).status,
        409,
      );
      assert.equal((await f.request(`${path}&cursor=${'x'.repeat(2049)}`)).status, 409);
      const next = await f.request(`${path}&cursor=${result.nextCursor}`);
      assert.equal(next.status, 200);
      assert.equal((await next.json()).choices[0].mediaId, target.id);
      assert.equal(f.provider.calls.at(-1).body.cursor, '400');
      f.provider.sources = [
        originalSource,
        { ...targetSource, classification: { ...targetSource.classification, rating: 'mixed' } },
      ];
      response = await f.request(path);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), unavailable[0]);
      await f.db.run(
        'UPDATE reader_sources SET classification=?,updated_at=? WHERE id=?',
        JSON.stringify({ ...targetSource.classification, rating: 'adult' }),
        '2000-01-01T00:00:00.000Z',
        targetSource.id,
      );
      f.provider.sources = [originalSource, targetSource];
      response = await f.request(path);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), unavailable[0]);
      await f.db.run(
        'INSERT OR REPLACE INTO catalog_media(id,payload,fetched_at) VALUES(?,?,?)',
        'mal-manga-21',
        JSON.stringify({ id: 'mal-manga-21', category: 'MANGA', title: 'CACHED CORE' }),
        Date.now(),
      );
      await store.addEquivalence(original.id, 'mal-manga-21', {
        kind: 'trusted-mapping',
        reference: 'reviewed-core-fixture',
      });
      await f.select({ overrides: { MangaDex: { yoru: false } }, modes: { yoru: 'core' } });
      f.provider.calls = [];
      response = await f.request(path);
      assert.equal(response.status, 200);
      result = await response.json();
      assert.equal(result.choices.length, 1);
      assert.equal(result.choices[0].mediaId, 'mal-manga-21');
      assert.equal(result.choices[0].sourceRef.id, 'weebcentral');
      assert.equal(result.choices[0].upstreamRef, null);
      assert.equal(result.choices[0].state, 'unresolved');
      assert.deepEqual(f.provider.calls, []);
      // Public source grammar is the identical signed64 parser through the actual
      // shared reader route, inventory validator, gateway and aggregation seam.
      for (const id of ['-1', '-9223372036854775808', '9223372036854775807']) {
        f.provider.sources = [alternativeSource(id)];
        assert.equal(
          (
            await f.request(
              `/api/reader/discovery?integration=extensions&source=${encodeURIComponent(`suwayomi:${id}`)}`,
            )
          ).status,
          200,
        );
      }
      for (const id of ['0', '01', '9223372036854775808', '-9223372036854775809'])
        assert.equal(
          (
            await f.request(
              `/api/reader/discovery?integration=extensions&source=${encodeURIComponent(`suwayomi:${id}`)}`,
            )
          ).status,
          400,
        );
    } finally {
      await f.close();
    }
  });
}
