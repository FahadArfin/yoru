import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inventorySource, inventoryRating } from './extension-catalog-contract.mjs';
import { createExternalCatalogStore } from '../server/external-catalog-store.js';
import { getReadingDiscovery } from '../server/catalog-aggregation.js';
import { executeReaderRoute } from '../server/reader-routes.js';
import {
  getReadingCatalog,
  getReadingChapter,
  getReaderChapter,
  getReaderCatalogs,
} from '../server/reading-sources.js';
import { deliveryHold } from './reader-final-delivery-contract.mjs';
import { ExtensionProviders } from '../services/reader-bridge/extension-providers.mjs';

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
  for (const operation of ['chapters', 'pages'])
    for (const restrictive of [false, true])
      test(`${label}: first ${operation} capability verification ${restrictive ? 'still rejects newer adult authority' : 'accepts provider reference promotion without rewriting authority'}`, async () => {
        const f = await fixture(),
          store = createExternalCatalogStore(f.db),
          gate = deliveryHold(operation);
        try {
          const startSource = source();
          startSource.capabilities[operation] = 'unverified';
          const bridgeTitle = title(startSource);
          const media = await store.rememberTitle(bridgeTitle);
          const provider = new ExtensionProviders();
          const providerSource = {
            ref: structuredClone(startSource),
            raw: { baseUrl: 'https://provider.invalid' },
            localMangaId: '1',
          };
          const edition = provider.edition(
            {
              id: '2',
              mangaId: '1',
              url: '/first/chapter',
              name: 'First chapter',
              chapterNumber: 1,
              sourceOrder: 0,
              pageCount: 1,
            },
            media.upstreamRef,
            providerSource,
          );
          assert.equal(
            edition.sourceRef,
            providerSource.ref,
            'real provider editions retain the mutable source reference',
          );
          const saved = await store.rememberEdition(media.id, edition);
          const invoke = async () => {
            await gate.wait();
            provider.verified(providerSource.ref, operation);
            assert.equal(edition.sourceRef.capabilities[operation], 'supported');
            return operation === 'chapters' ? { items: [edition] } : { edition, pages: [0] };
          };
          const options = {
            readerDb: f.db,
            context,
            bridge: { details: async () => bridgeTitle, chapters: invoke, reader: invoke },
          };
          const pending = (
            operation === 'chapters'
              ? getReadingCatalog(media.id, {}, options)
              : getReaderChapter(media.id, saved.id, options)
          ).then(
            (value) => ({ value }),
            (error) => ({ error }),
          );
          await gate.waiting;
          if (restrictive)
            await store.rememberSource({
              ...startSource,
              classification: inventoryRating('adult'),
            });
          const proof = await store.getSourceAuthority(startSource.id);
          const rows = await f.db.all('SELECT * FROM external_editions');
          gate.release();
          const result = await pending;
          if (restrictive) {
            assert.equal(result.error?.status, 409);
            assert.deepEqual(await f.db.all('SELECT * FROM external_editions'), rows);
          } else {
            assert.equal(result.error, undefined, result.error?.message);
            assert.equal(
              operation === 'chapters' ? result.value.items.length : result.value.pages.length,
              1,
            );
          }
          assert.deepEqual(await store.getSourceAuthority(startSource.id), proof);
        } finally {
          gate.release();
          await f.close();
        }
      });

  for (const operation of ['chapters', 'chapter', 'reader'])
    test(`${label}: delayed ${operation} cannot replace source authority or accept stale edition rows`, async () => {
      const f = await fixture(),
        store = createExternalCatalogStore(f.db),
        gate = deliveryHold(operation);
      try {
        const bridgeTitle = title(source());
        const media = await store.rememberTitle(bridgeTitle);
        const bridgeEdition = {
          sourceRef: source(),
          upstreamRef: { title: media.upstreamRef, upstreamKey: '/chapter' },
          metadata: { title: 'Original', number: '1', pages: 1 },
        };
        const edition = await store.rememberEdition(media.id, bridgeEdition);
        const options = {
          readerDb: f.db,
          context,
          bridge: {
            details: async () => bridgeTitle,
            [operation]: async () => {
              await gate.wait();
              const fresh = {
                ...bridgeEdition,
                metadata: { ...bridgeEdition.metadata, title: 'Stale update' },
              };
              return operation === 'chapters'
                ? { items: [fresh] }
                : operation === 'reader'
                  ? { edition: fresh, pages: [0] }
                  : fresh;
            },
          },
        };
        const pending = (
          operation === 'chapters'
            ? getReadingCatalog(media.id, {}, options)
            : operation === 'chapter'
              ? getReadingChapter(media.id, edition.id, options)
              : getReaderChapter(media.id, edition.id, options)
        ).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        await gate.waiting;
        const before = await f.db.all('SELECT * FROM external_editions');
        await store.rememberSource(source('adult'));
        const proof = await store.getSourceAuthority(source().id);
        gate.release();
        const result = await pending;
        assert.ok(result.error, 'stale edition response must fail');
        assert.deepEqual(await store.getSourceAuthority(source().id), proof);
        assert.deepEqual(await f.db.all('SELECT * FROM external_editions'), before);
      } finally {
        gate.release();
        await f.close();
      }
    });

  test(`${label}: edition batches and concurrent healthy chapter requests retain source authority`, async () => {
    const f = await fixture(),
      store = createExternalCatalogStore(f.db);
    try {
      const media = await store.rememberTitle(title(source()));
      const input = {
        sourceRef: source(),
        upstreamRef: { title: media.upstreamRef, upstreamKey: '/healthy/1' },
        metadata: { number: '1', pageCount: 1 },
      };
      const before = await store.getSourceAuthority(source().id);
      await Promise.all([
        store.rememberEdition(media.id, input),
        store.rememberEdition(media.id, {
          ...input,
          upstreamRef: { ...input.upstreamRef, upstreamKey: '/healthy/2' },
        }),
      ]);
      assert.deepEqual(
        await store.getSourceAuthority(source().id),
        before,
        'edition writes do not claim a fresh source observation',
      );
      assert.equal((await f.db.all('SELECT * FROM external_editions')).length, 2);
    } finally {
      await f.close();
    }
  });

  test(`${label}: chapter batch never adopts concurrent adult proof between its own edition writes`, async () => {
    const f = await fixture(),
      store = createExternalCatalogStore(f.db);
    let intervened = false;
    try {
      const bridgeTitle = title(source());
      const media = await store.rememberTitle(bridgeTitle);
      const db = {
        ...f.db,
        async atomic(statements, ...args) {
          const result = await f.db.atomic(statements, ...args);
          if (
            !intervened &&
            statements.some((s) => s.sql.includes('INSERT INTO external_editions'))
          ) {
            intervened = true;
            await store.rememberSource(source('adult'));
          }
          return result;
        },
      };
      await assert.rejects(
        getReadingCatalog(
          media.id,
          {},
          {
            readerDb: db,
            context,
            bridge: {
              details: async () => bridgeTitle,
              chapters: async () => ({
                items: [1, 2].map((n) => ({
                  sourceRef: source(),
                  upstreamRef: { title: media.upstreamRef, upstreamKey: `/batch/${n}` },
                  metadata: { number: String(n) },
                })),
              }),
            },
          },
        ),
        { status: 409 },
      );
      assert.equal(intervened, true);
      assert.equal((await f.db.all('SELECT * FROM external_editions')).length, 1);
      assert.equal(
        (await store.getSourceAuthority(source().id)).source.classification.rating,
        'adult',
      );
    } finally {
      await f.close();
    }
  });

  test(`${label}: held healthy manifest accepts concurrent same-policy refresh without overwriting it`, async () => {
    const f = await fixture(),
      store = createExternalCatalogStore(f.db),
      gate = deliveryHold('reader');
    try {
      const bridgeTitle = title(source());
      const media = await store.rememberTitle(bridgeTitle);
      const input = {
        sourceRef: source(),
        upstreamRef: { title: media.upstreamRef, upstreamKey: '/healthy' },
        metadata: { number: '1', pageCount: 1 },
      };
      const edition = await store.rememberEdition(media.id, input);
      const pending = getReaderChapter(media.id, edition.id, {
        readerDb: f.db,
        context,
        bridge: {
          details: async () => bridgeTitle,
          reader: async () => {
            await gate.wait();
            return { edition: input, pages: [0] };
          },
        },
      });
      await gate.waiting;
      const fresh = source();
      fresh.classification.provenance.checkedAt = '2026-10-19T12:00:00Z';
      await store.rememberSource(fresh);
      const proof = await store.getSourceAuthority(source().id);
      gate.release();
      assert.equal((await pending).pages.length, 1);
      assert.deepEqual(await store.getSourceAuthority(source().id), proof);
    } finally {
      gate.release();
      await f.close();
    }
  });

  test(`${label}: legacy Settings accepts only canonical signed64 source strings`, async () => {
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
    const result = await getReaderCatalogs({
      bridgeKey: 'fixture-key-longer-than-32-characters',
      bridgeUrl: 'https://fixture.trycloudflare.com',
      fetchImpl: async () =>
        Response.json({
          sources: [...valid, ...invalid].map((id) => ({ id, name: 'Fixture', language: 'en' })),
        }),
    });
    assert.deepEqual(
      result.sources.map((s) => s.id),
      valid,
    );
  });
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
