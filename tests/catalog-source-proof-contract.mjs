import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inventorySource, inventoryRating } from './extension-catalog-contract.mjs';
import { createExternalCatalogStore } from '../server/external-catalog-store.js';
import { getReadingDiscovery } from '../server/catalog-aggregation.js';
import { executeReaderRoute } from '../server/reader-routes.js';

const context = {
  destination: 'yoru',
  integrationMode: 'extensions',
  guestId: 'source-proof-fixture',
  userId: null,
  selectionFingerprint: 'source-proof',
  overrides: {},
  extensionsEnabled: true,
};
const source = (value = 'safe') => ({
  ...inventorySource(123),
  classification: inventoryRating(value),
});
const title = (sourceRef, key = '/race/title') => ({
  sourceRef,
  upstreamRef: { sourceId: sourceRef.id, upstreamKey: key, language: 'en' },
  classification: inventoryRating('safe'),
  metadata: { title: 'Source proof fixture', cover: 'https://private.invalid/cover' },
});
const fixedNow = () => 1800000000000;
function hold() {
  let entered, release;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const released = new Promise((resolve) => {
    release = resolve;
  });
  return {
    waiting,
    release,
    async wait() {
      entered();
      await released;
    },
  };
}

export function catalogSourceProofContract(label, fixture) {
  for (const path of ['aggregate', 'resolve-link']) {
    for (const initial of ['absent', 'safe', 'adult'])
      test(`${label}: ${path} cannot replace concurrent adult source proof after ${initial} request-start authority`, async () => {
        const f = await fixture(),
          store = createExternalCatalogStore(f.db, { now: fixedNow }),
          gate = hold();
        try {
          if (initial !== 'absent') await store.rememberSource(source(initial));
          const initialRow = await f.db.get('SELECT * FROM reader_sources WHERE id=?', source().id);
          const deps = {
            db: f.db,
            now: fixedNow,
            bridge: {
              async catalogs() {
                return { sources: [source()], nextCursor: null };
              },
              async browse() {
                await gate.wait();
                return { items: [title(source())], hasMore: false };
              },
              async resolveLink() {
                await gate.wait();
                return title(source());
              },
            },
          };
          const pending =
            path === 'aggregate'
              ? getReadingDiscovery({}, context, deps)
              : executeReaderRoute(
                  'resolve-link',
                  { source: source().id, url: 'https://provider.invalid/title' },
                  context,
                  deps,
                  {},
                );
          // Attach the rejection observer before releasing asynchronous provider work.
          const outcome = pending.then(
            (value) => ({ value }),
            (error) => ({ error }),
          );
          await gate.waiting;
          await store.rememberSource(source('adult'));
          const concurrentRow = await f.db.get(
            'SELECT * FROM reader_sources WHERE id=?',
            source().id,
          );
          gate.release();
          const result = await outcome;
          const current = await f.db.get('SELECT * FROM reader_sources WHERE id=?', source().id);
          assert.equal(
            JSON.parse(current.classification).rating,
            'adult',
            'an older safe provider response must not erase newer restrictive authority',
          );
          assert.equal(
            current.updated_at,
            concurrentRow.updated_at,
            'failed stale response must not rewrite the newer proof token',
          );
          assert.equal(
            (await f.db.all('SELECT * FROM external_media')).length,
            0,
            'CAS must precede title persistence',
          );
          assert.equal(
            (await f.db.all('SELECT * FROM reader_feed_cache')).length,
            0,
            'no safe feed cache row may escape',
          );
          if (path === 'aggregate') {
            assert.deepEqual(result.value?.items, []);
            assert.deepEqual(result.value?.updates, []);
            assert.ok(result.value.nextCursor, 'source proof conflict remains resumable');
            const state = JSON.parse(
              (
                await f.db.get(
                  'SELECT payload FROM reader_continuations WHERE id=?',
                  result.value.nextCursor,
                )
              ).payload,
            );
            assert.equal(state.positions[source().id].page, 1);
            assert.equal(state.positions[source().id].done, false);
            assert.ok(
              result.value.sourceStates.some(
                (state) =>
                  state.sourceId === source().id &&
                  state.state === 'unavailable' &&
                  state.status === 409,
              ),
            );
          } else {
            assert.ok(
              result.error,
              'resolve-link rejects instead of serializing stale native data',
            );
            assert.equal(result.error.status, 409);
          }
          if (initial === 'adult')
            assert.notEqual(
              concurrentRow.updated_at,
              initialRow.updated_at,
              'same-classification observations need distinct proof tokens even under a frozen clock',
            );
        } finally {
          gate.release();
          await f.close();
        }
      });

    test(`${label}: ${path} still accepts a fresh source classification change without a concurrent write`, async () => {
      const f = await fixture(),
        store = createExternalCatalogStore(f.db, { now: fixedNow });
      try {
        await store.rememberSource(source('adult'));
        const deps = {
          db: f.db,
          now: fixedNow,
          bridge: {
            async catalogs() {
              return { sources: [source()], nextCursor: null };
            },
            async browse() {
              return { items: [title(source())], hasMore: false };
            },
            async resolveLink() {
              return title(source());
            },
          },
        };
        const result =
          path === 'aggregate'
            ? await getReadingDiscovery({}, context, deps)
            : await executeReaderRoute(
                'resolve-link',
                { source: source().id, url: 'https://provider.invalid/title' },
                context,
                deps,
                {},
              );
        assert.equal(
          path === 'aggregate' ? result.items.length : !!result.id,
          path === 'aggregate' ? 1 : true,
        );
        assert.equal(
          JSON.parse(
            (await f.db.get('SELECT classification FROM reader_sources WHERE id=?', source().id))
              .classification,
          ).rating,
          'safe',
        );
        assert.equal((await f.db.all('SELECT * FROM external_media')).length, 1);
        assert.doesNotMatch(
          JSON.stringify(result),
          /sourceAuthority/,
          'private CAS token is never a public DTO field',
        );
      } finally {
        await f.close();
      }
    });
  }

  test(`${label}: aggregate chains its own committed proof across every title in a fresh page`, async () => {
    const f = await fixture(),
      store = createExternalCatalogStore(f.db, { now: fixedNow });
    try {
      await store.rememberSource(source('adult'));
      const deps = {
        db: f.db,
        now: fixedNow,
        currentSources: [source()],
        bridge: {
          async browse() {
            return { items: [1, 2, 3].map((n) => title(source(), `/batch/${n}`)), hasMore: false };
          },
        },
      };
      const result = await getReadingDiscovery({}, context, deps);
      assert.equal(
        result.items.length,
        3,
        'own first-title source write must not falsely reject later titles',
      );
      assert.equal((await f.db.all('SELECT * FROM external_media')).length, 3);
      assert.equal(
        JSON.parse((await f.db.get('SELECT classification FROM reader_sources')).classification)
          .rating,
        'safe',
      );
      assert.doesNotMatch(JSON.stringify(result), /sourceAuthority/);
    } finally {
      await f.close();
    }
  });

  test(`${label}: aggregate never recaptures a concurrent authority to bless later titles in an old page`, async () => {
    const f = await fixture(),
      store = createExternalCatalogStore(f.db, { now: fixedNow });
    let intervene = true;
    const db = {
      ...f.db,
      async atomic(statements, ...args) {
        const result = await f.db.atomic(statements, ...args);
        if (
          intervene &&
          statements.some((statement) => statement.sql.includes('INSERT INTO external_media'))
        ) {
          intervene = false;
          await store.rememberSource(source('adult'));
        }
        return result;
      },
    };
    try {
      const result = await getReadingDiscovery({}, context, {
        db,
        now: fixedNow,
        currentSources: [source()],
        bridge: {
          async browse() {
            return {
              items: [title(source(), '/batch/first'), title(source(), '/batch/later')],
              hasMore: false,
            };
          },
        },
      });
      assert.equal(intervene, false, 'actual source write race was exercised');
      assert.equal(
        JSON.parse((await f.db.get('SELECT classification FROM reader_sources')).classification)
          .rating,
        'adult',
      );
      assert.deepEqual(result.items, []);
      assert.deepEqual(result.updates, []);
      assert.equal(
        (await f.db.all('SELECT * FROM external_media')).length,
        1,
        'only the title committed before the newer proof exists; later stale title cannot insert',
      );
      assert.equal((await f.db.all('SELECT * FROM reader_feed_cache')).length, 0);
    } finally {
      await f.close();
    }
  });
}
