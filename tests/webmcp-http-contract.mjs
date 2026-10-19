import assert from 'node:assert/strict';
import { accountSource } from './extension-account-contract.mjs';
import { createExternalCatalogStore } from '../server/external-catalog-store.js';

export function nativeToolProvider() {
  const sources = [accountSource(), accountSource('124', 'adult', 'Aunt Manhwa')];
  const titles = new Map();
  return {
    sources,
    respond(path, input) {
      if (path === '/extension/catalogs') return { sources, nextCursor: null };
      if (path === '/extension/details') return titles.get(input.titleRef?.upstreamKey);
      if (path === '/extension/browse')
        return {
          items: [...titles.values()].filter((title) => title.sourceRef.id === input.sourceId),
          nextPage: input.page + 1,
          hasMore: true,
        };
      return null;
    },
    async seed(db, source, key) {
      const title = {
        sourceRef: source,
        upstreamRef: { sourceId: source.id, upstreamKey: key, language: source.language },
        classification: source.classification,
        metadata: { title: 'Synthetic tool contract', category: 'MANGA' },
      };
      titles.set(key, title);
      return createExternalCatalogStore(db).rememberTitle(title);
    },
  };
}

// The page tools use these existing public routes. This contract proves real
// backend ownership/eligibility separately from the browser's synthetic registry.
export async function nativeToolHttpContract({ request, db, provider }) {
  const register = async (name) => {
    const result = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name,
        email: `${name}@fixture.test`,
        password: 'native-tools-fixture-password',
      },
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return { user: result.body.user, cookie: result.headers.get('set-cookie').split(';')[0] };
  };
  const alice = await register('NativeToolsAlice'),
    bob = await register('NativeToolsBob');
  const safe = await provider.seed(db, provider.sources[0], '/tool/safe');
  const adult = await provider.seed(db, provider.sources[1], '/tool/ara');
  let result = await request(`/api/media/${safe.id}?destination=yoru`, { session: alice });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.id, safe.id);
  assert.equal(result.body.sourceRef.id, 'suwayomi:123');
  assert.equal(result.body.malId, null);
  assert.equal(
    new URL(result.body.cover, 'http://fixture.test').searchParams.get('destination'),
    'yoru',
  );
  result = await request(`/api/library/${safe.id}?destination=yoru`, {
    method: 'PUT',
    session: alice,
    body: { favorite: true, status: 'reading', userId: bob.user.id },
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.item.mediaId, safe.id);
  const own = await request('/api/library?destination=yoru', { session: alice });
  assert.equal(own.status, 200);
  assert.deepEqual(
    own.body.items.map((x) => x.mediaId),
    [safe.id],
  );
  const other = await request(
    `/api/library?destination=yoru&owner=${alice.user.id}&userId=${alice.user.id}`,
    { session: bob },
  );
  assert.equal(other.status, 200);
  assert.deepEqual(other.body.items, [], 'injected owner does not select another account');
  for (const path of [`/api/media/${adult.id}`, `/api/media/${adult.id}/cover`])
    assert.equal((await request(path + '?destination=yoru', { session: alice })).status, 404);
  assert.equal(
    (
      await request(`/api/library/${adult.id}?destination=yoru`, {
        method: 'PUT',
        session: alice,
        body: { favorite: true },
      })
    ).status,
    404,
  );
  result = await request(`/api/library/${adult.id}?destination=ara-ara`, {
    method: 'PUT',
    session: alice,
    body: { favorite: true },
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const yoru = await request('/api/library?destination=yoru', { session: alice });
  const ara = await request('/api/library?destination=ara-ara', { session: alice });
  assert.deepEqual(
    yoru.body.items.map((x) => x.mediaId),
    [safe.id],
  );
  assert.deepEqual(
    ara.body.items.map((x) => x.mediaId),
    [adult.id],
  );
  assert.equal(
    (await request(`/api/media/${safe.id}/sources?episode=1&language=sub`, { session: alice }))
      .status,
    400,
  );
  const path =
    '/api/reader/browse?destination=yoru&integration=extensions&source=suwayomi:123&mode=search&q=tool&limit=1';
  const first = await request(path, { session: alice });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.items[0].id, safe.id);
  assert.equal(typeof first.body.nextCursor, 'string');
  const cursor = '&cursor=' + encodeURIComponent(first.body.nextCursor);
  const crossedOwner = await request(path + cursor, { session: bob });
  assert.equal(crossedOwner.status, 409, 'opaque cursor cannot select another account context');
  assert.equal(crossedOwner.body.restartRequired, true);
  const crossedDestination = await request(
    path.replace('destination=yoru', 'destination=ara-ara') + cursor,
    { session: alice },
  );
  assert.equal(crossedDestination.status, 409);
  assert.equal(crossedDestination.body.restartRequired, true);
  const continued = await request(path + cursor, { session: alice });
  assert.equal(continued.status, 200, JSON.stringify(continued.body));
}
