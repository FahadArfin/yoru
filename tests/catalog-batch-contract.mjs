import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExternalCatalogStore } from '../server/external-catalog-store.js';
import { getReaderCover } from '../server/reading-sources.js';
import { getReadingDiscovery } from '../server/catalog-aggregation.js';

const classification = (rating = 'safe') => ({
  rating,
  provenance: {
    sourceField: 'source.contentWarning',
    value: rating,
    checkedAt: '2026-10-19T00:00:00Z',
  },
});
const source = {
  id: 'suwayomi:123',
  upstreamSourceId: '123',
  integration: 'suwayomi',
  providerKey: 'MangaDex',
  language: 'en',
  classification: classification(),
  bridgeInstance: 'fixture',
  capabilities: Object.fromEntries(
    ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map((k) => [
      k,
      'supported',
    ]),
  ),
};
const titles = (count) =>
  Array.from({ length: count }, (_, i) => ({
    sourceRef: source,
    upstreamRef: { sourceId: source.id, upstreamKey: `/title/${i}`, language: 'en' },
    classification: classification(),
    metadata: { title: `Catalog title ${i}` },
  }));
const context = {
  destination: 'yoru',
  integrationMode: 'extensions',
  guestId: 'batch-guest',
  selectionFingerprint: 'batch',
  overrides: {},
  extensionsEnabled: true,
};

export function catalogBatchContract(label, fixture) {
  test(`${label}: malformed snapshots are skipped without poisoning subsequent titles`, async () => {
    const f = await fixture();
    try {
      const inputs = titles(3);
      const result = await getReadingDiscovery({}, context, {
        db: f.db,
        currentSources: [source],
        bridge: {
          browse: async () => ({
            items: [
              inputs[0],
              null,
              { ...inputs[1], sourceRef: { ...source, classification: undefined } },
              inputs[2],
            ],
            hasMore: false,
          }),
        },
      });
      assert.equal(result.items.length, 2);
      assert.equal(result.sourceStates[0].state, 'ready');
    } finally {
      await f.close();
    }
  });
  test(`${label}: large Unicode descriptions stay within database TEXT argument bounds`, async () => {
    const f = await fixture();
    const check = (value) => {
      if (typeof value === 'string')
        assert.ok(Buffer.byteLength(value) <= 2 * 1024 * 1024, 'oversized database argument');
      else if (Array.isArray(value)) value.forEach(check);
      else if (value && typeof value === 'object') Object.values(value).forEach(check);
    };
    const db = Object.fromEntries(
      Object.entries(f.db).map(([k, fn]) => [
        k,
        async (...args) => {
          check(args);
          return fn(...args);
        },
      ]),
    );
    try {
      const inputs = titles(51).map((item) => ({
        ...item,
        metadata: { ...item.metadata, description: '漢'.repeat(20000) },
      }));
      const result = await getReadingDiscovery({ limit: 24 }, context, {
        db,
        currentSources: [source],
        bridge: { browse: async () => ({ items: inputs, hasMore: false }) },
      });
      assert.equal(result.items.length, 24);
      assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM reader_feed_cache')).n, 51);
    } finally {
      await f.close();
    }
  });
  test(`${label}: harmless refresh accepts capability verification but rejects a newer restrictive source`, async () => {
    const f = await fixture(),
      store = createExternalCatalogStore(f.db);
    try {
      const [input] = titles(1);
      const unverified = {
        ...source,
        capabilities: { ...source.capabilities, details: 'unverified' },
      };
      await store.rememberTitle({ ...input, sourceRef: unverified });
      const expectedSource = await store.getSourceAuthority(source.id);
      await store.rememberTitle(input, { expectedSource, preserveSource: true });
      assert.equal((await store.getSourceAuthority(source.id)).version, expectedSource.version);
      await store.rememberSource({ ...unverified, classification: classification('adult') });
      await assert.rejects(
        store.rememberTitle(input, { expectedSource, preserveSource: true }),
        (e) => e.status === 409,
      );
      assert.equal(
        (await store.getSourceAuthority(source.id)).source.classification.rating,
        'adult',
      );
    } finally {
      await f.close();
    }
  });
  test(`${label}: a 100-title feed uses bounded database round trips and preserves every continuation title`, async () => {
    const f = await fixture();
    let trips = 0;
    const db = Object.fromEntries(
      Object.entries(f.db).map(([k, fn]) => [
        k,
        async (...args) => {
          trips++;
          return fn(...args);
        },
      ]),
    );
    const deps = {
      db,
      currentSources: [source],
      bridge: { browse: async () => ({ items: titles(100), hasMore: false, nextPage: null }) },
    };
    try {
      const first = await getReadingDiscovery({ limit: 24 }, context, deps);
      assert.equal(first.items.length, 24);
      assert.ok(trips < 130, `100-title page used ${trips} DB round trips`);
      const ids = new Set(first.items.map((x) => x.id));
      let page = first;
      while (page.hasMore) {
        page = await getReadingDiscovery({ limit: 24, cursor: page.nextCursor }, context, deps);
        for (const item of page.items) {
          assert.ok(!ids.has(item.id));
          ids.add(item.id);
        }
      }
      assert.equal(ids.size, 100);
    } finally {
      await f.close();
    }
  });

  test(`${label}: batched persistence retains IDs and rejects a stale source proof atomically`, async () => {
    const f = await fixture(),
      store = createExternalCatalogStore(f.db);
    try {
      assert.equal(typeof store.rememberTitles, 'function');
      const first = await store.rememberTitles(titles(3), { expectedSource: null });
      assert.equal(new Set(first.map((x) => x.id)).size, 3);
      const again = await store.rememberTitles(titles(3), {
        expectedSource: first[0].sourceAuthority,
      });
      assert.deepEqual(
        again.map((x) => x.id),
        first.map((x) => x.id),
      );
      await store.rememberSource({ ...source, classification: classification('adult') });
      await assert.rejects(
        store.rememberTitles(titles(4), { expectedSource: again[0].sourceAuthority }),
        (e) => e.status === 409,
      );
      assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM external_media')).n, 3);
      assert.equal(
        (await store.getSourceAuthority(source.id)).source.classification.rating,
        'adult',
      );
    } finally {
      await f.close();
    }
  });
  test(`${label}: concurrent covers retain source authority instead of conflicting on harmless refreshes`, async () => {
    const f = await fixture(),
      store = createExternalCatalogStore(f.db);
    try {
      const inputs = titles(3),
        media = [];
      for (const input of inputs) media.push(await store.rememberTitle(input));
      let arrived = 0,
        release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const before = await store.getSourceAuthority(source.id);
      const options = {
        readerDb: f.db,
        context,
        bridge: {
          async details(ref) {
            arrived++;
            if (arrived === 3) release();
            await gate;
            return inputs.find((item) => item.upstreamRef.upstreamKey === ref.upstreamKey);
          },
          async cover() {
            return { body: new Uint8Array([1]), type: 'image/jpeg' };
          },
        },
      };
      const results = await Promise.all(media.map((item) => getReaderCover(item.id, options)));
      assert.equal(results.length, 3);
      assert.ok(results.every((result) => result.body[0] === 1));
      assert.equal((await store.getSourceAuthority(source.id)).version, before.version);
    } finally {
      await f.close();
    }
  });
}
