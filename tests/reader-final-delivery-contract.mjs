import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createExternalCatalogStore } from '../server/external-catalog-store.js';
import { inventoryRating } from './extension-catalog-contract.mjs';

export function deliveryHold(operation) {
  let entered, release;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const released = new Promise((resolve) => {
    release = resolve;
  });
  return {
    operation,
    waiting,
    release,
    async wait() {
      entered();
      await released;
    },
  };
}

export async function finalDeliveryContract(f, media) {
  const store = createExternalCatalogStore(f.readerDb);
  const source = media.sourceRef;
  const edition = await store.rememberEdition(media.id, {
    sourceRef: source,
    upstreamRef: { title: media.upstreamRef, upstreamKey: '/chapter/1' },
    metadata: { number: '1', pageCount: 1, title: 'Original chapter' },
  });
  const routes = [
    [`/api/media/${media.id}/cover`, '/extension/cover'],
    [`/api/reader/media/${media.id}/cover`, '/extension/cover'],
    [`/api/media/${media.id}/reader/${edition.id}/page/0`, '/extension/page'],
    [`/api/media/${media.id}/reader/${edition.id}`, '/extension/reader'],
    [`/api/media/${media.id}/chapters`, '/extension/chapters'],
    [`/api/media/${media.id}/chapters/${edition.id}/open?destination=yoru`, '/extension/chapter'],
  ];
  // Actual public routes hold the private bridge after all request-start checks.
  for (const [path, operation] of routes) {
    for (const mutation of ['adult', 'membership', 'session', 'unchanged']) {
      await store.rememberSource(source);
      const guest = await f.guest({});
      const session = 'final-delivery-session';
      const hash = createHash('sha256').update(session).digest('hex');
      if (mutation === 'session') {
        await f.readerDb.run(
          "INSERT OR IGNORE INTO users(id,name,email,created_at) VALUES('delivery-user','Delivery','delivery@test.invalid','2026-10-19')",
        );
        await f.readerDb.run(
          'INSERT OR REPLACE INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
          hash,
          'delivery-user',
          Date.now() + 60000,
          '2026-10-19',
        );
      }
      const gate = deliveryHold(operation);
      f.provider.state.hold = gate;
      const pending = f.request(path, {
        cookie: mutation === 'session' ? `yoru_session=${session}` : guest,
        ...(operation === '/extension/chapter' ? { method: 'POST', body: {} } : {}),
      });
      await gate.waiting;
      const editionsBefore = await f.readerDb.all('SELECT * FROM external_editions ORDER BY id');
      let adultProof;
      try {
        if (mutation === 'adult') {
          await store.rememberSource({ ...source, classification: inventoryRating('adult') });
          adultProof = await store.getSourceAuthority(source.id);
        }
        if (mutation === 'membership') {
          const changed = await f.request('/api/reader/context', {
            method: 'POST',
            cookie: guest,
            body: {
              destination: 'yoru',
              expectedRevision: 1,
              selection: { overrides: { MangaDex: { yoru: false } } },
            },
          });
          assert.equal(changed.status, 200);
        }
        if (mutation === 'session')
          await f.readerDb.run('DELETE FROM sessions WHERE token_hash=?', hash);
      } finally {
        gate.release();
      }
      const response = await pending;
      f.provider.state.hold = null;
      if (mutation === 'unchanged') {
        assert.equal(response.status, 200, `${path}: unchanged eligible request`);
        if (operation === '/extension/chapters')
          assert.equal((await response.json()).items.length, 2);
        else await response.arrayBuffer();
      } else {
        assert.ok(
          response.status >= 400 && response.status < 500,
          `${path}: ${mutation} must deny delivery; got ${response.status}`,
        );
        assert.doesNotMatch(response.headers.get('content-type') || '', /^image\//);
        assert.ok((await response.json()).error);
      }
      if (adultProof) {
        assert.deepEqual(
          await store.getSourceAuthority(source.id),
          adultProof,
          `${operation}: adult authority unchanged`,
        );
        assert.deepEqual(
          await f.readerDb.all('SELECT * FROM external_editions ORDER BY id'),
          editionsBefore,
          `${operation}: stale edition not accepted`,
        );
      }
    }
  }
  await store.rememberSource(source);
  const modeGuest = await f.guest({ modes: { yoru: 'core' } });
  for (const [path] of routes.slice(0, 4))
    assert.equal(
      (await f.request(path, { cookie: modeGuest })).status,
      200,
      'exact pinned edition survives browse-only mode selection',
    );

  const originalSources = f.provider.state.sources;
  const valid = ['1', '-1', '9223372036854775807', '-9223372036854775808'];
  const invalid = [
    '0',
    '-0',
    '01',
    '-01',
    '+1',
    '9223372036854775808',
    '-9223372036854775809',
    '1e2',
    ' 1',
    123,
  ];
  f.provider.state.sources = [...valid, ...invalid].map((id) => ({
    upstreamSourceId: id,
    providerKey: 'Boundary fixture',
    language: 'en',
  }));
  const inventory = await f.request('/api/reader/catalogs');
  assert.equal(inventory.status, 200);
  assert.deepEqual(
    (await inventory.json()).sources,
    valid.map((id) => ({ id, name: 'Boundary fixture', language: 'en' })),
  );
  f.provider.state.sources = originalSources;
}
