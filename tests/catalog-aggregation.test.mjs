import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextFixture } from './reader-context-fixture.mjs';

export const rating = (value = 'safe') => ({
  rating: value,
  provenance: { sourceField: 'source.contentWarning', value, checkedAt: '2026-10-19T00:00:00Z' },
});
export const source = (id) => ({
  id: `suwayomi:${id}`,
  upstreamSourceId: String(id),
  integration: 'suwayomi',
  providerKey: 'MangaDex',
  language: 'en',
  classification: rating(),
  capabilities: Object.fromEntries(
    ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map((k) => [
      k,
      'supported',
    ]),
  ),
  bridgeInstance: 'fixture',
});
export const title = (s, page = 1) => ({
  sourceRef: s,
  upstreamRef: { sourceId: s.id, upstreamKey: `/title/${page}`, language: 'en' },
  classification: rating(),
  metadata: { title: `Same name`, cover: 'https://private.invalid/cover' },
});
export const context = {
  destination: 'yoru',
  integrationMode: 'extensions',
  userId: null,
  guestId: 'fixture-guest',
  selectionFingerprint: 'one',
  overrides: {},
  extensionsEnabled: true,
};

test('Manhwa summaries hydrate in bounded batches without losing continuation titles', async () => {
  const { getReadingDiscovery } = await import('../server/catalog-aggregation.js');
  const f = contextFixture();
  const s = { ...source(55), providerKey: 'Manhwa18.cc' };
  let browses = 0,
    details = 0;
  const deps = {
    db: f.db,
    currentSources: [s],
    bridge: {
      browse: async () => {
        browses++;
        return {
          items: Array.from({ length: 6 }, (_, i) => title(s, i + 1)),
          hasMore: false,
        };
      },
      details: async (ref) => {
        details++;
        const n = Number(ref.upstreamKey.split('/').pop());
        return {
          ...title(s, n),
          metadata: {
            title: `Detailed ${n}`,
            genres: n === 6 ? ['Manga'] : ['Manhwa'],
            description: 'Provider description',
            status: 'COMPLETED',
          },
        };
      },
    },
  };
  const ctx = { ...context, destination: 'ara-ara' };
  try {
    const first = await getReadingDiscovery({ category: 'manhwa' }, ctx, deps);
    assert.equal(first.items.length, 4);
    assert.equal(details, 4);
    assert.equal(first.hasMore, true);
    assert.ok(
      first.items.every(
        (item) => item.category === 'MANHWA' && item.description === 'Provider description',
      ),
    );
    const second = await getReadingDiscovery(
      { category: 'manhwa', cursor: first.nextCursor },
      ctx,
      deps,
    );
    assert.equal(second.items.length, 1);
    assert.equal(second.items[0].title, 'Detailed 5');
    assert.equal(second.hasMore, false);
    assert.equal(browses, 1);
    assert.equal(details, 6);
  } finally {
    f.close();
  }
});

test('Manhwa discovery skips unrelated extensions and requires title evidence', async () => {
  const { getReadingDiscovery } = await import('../server/catalog-aggregation.js');
  const f = contextFixture();
  const sources = [
    { ...source(11), providerKey: '3Hentai' },
    { ...source(12), providerKey: 'Manhwa18.cc' },
  ];
  const calls = [];
  try {
    const result = await getReadingDiscovery(
      { category: 'manhwa' },
      {
        ...context,
        destination: 'ara-ara',
        overrides: {},
      },
      {
        db: f.db,
        currentSources: sources,
        bridge: {
          browse: async ({ sourceId }) => {
            calls.push(sourceId);
            return {
              items: [
                {
                  ...title(sources[1], 1),
                  metadata: { title: 'Tagged title', category: 'MANGA', genres: ['Manhwa'] },
                },
                {
                  ...title(sources[1], 2),
                  metadata: { title: 'Unknown origin', category: 'MANGA' },
                },
              ],
              hasMore: false,
            };
          },
        },
      },
    );
    assert.deepEqual(calls, ['suwayomi:12']);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].category, 'MANHWA');
    assert.equal(result.items[0].title, 'Tagged title');
  } finally {
    f.close();
  }
});

test('partial feeds remain fair within four operations and twelve seconds', async () => {
  const { getReadingDiscovery } = await import('../server/catalog-aggregation.js');
  const { createContinuationStore } = await import('../server/reader-continuation.js');
  const f = contextFixture();
  let active = 0,
    maxConcurrent = 0,
    calls = [];
  const sources = Array.from({ length: 6 }, (_, i) => source(i + 1));
  const deps = {
    db: f.db,
    now: () => 1000,
    currentSources: sources,
    continuationStore: createContinuationStore(f.db, { now: () => 1000 }),
    bridge: {
      async browse(input, op) {
        assert.ok(
          input.filters === undefined ||
            (Array.isArray(input.filters) && input.filters.length === 0),
          'gateway accepts only validated empty filters',
        );
        calls.push(input);
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        assert.equal(op.deadlineAt, 13000);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        if (input.sourceId === sources[0].id)
          throw Object.assign(new Error('PRIVATE upstream'), { status: 503 });
        return {
          items: [
            title(
              sources.find((s) => s.id === input.sourceId),
              input.page,
            ),
          ],
          hasMore: true,
          nextPage: input.page + 1,
        };
      },
    },
  };
  try {
    const first = await getReadingDiscovery({ limit: 20 }, context, deps);
    assert.equal(calls.length, 4);
    assert.ok(maxConcurrent <= 2);
    assert.equal(first.total, null);
    assert.equal(first.items.length, 3);
    assert.equal(first.totalIsEstimate, true);
    assert.ok(first.nextCursor);
    const state = await deps.continuationStore.resume(first.nextCursor, context);
    assert.equal(state.positions[sources[0].id].page, 1);
    assert.equal(state.positions[sources[4].id].page, 1);
    assert.equal(state.positions[sources[1].id].page, 2);
    calls = [];
    const second = await getReadingDiscovery(
      { limit: 20, cursor: first.nextCursor },
      context,
      deps,
    );
    assert.ok(calls.length <= 4);
    assert.ok(maxConcurrent <= 2);
    for (const s of sources.slice(4))
      assert.ok(second.items.some((item) => item.sourceRef.id === s.id));
    assert.equal(
      new Set([...first.items, ...second.items].map((i) => i.id)).size,
      first.items.length + second.items.length,
      'same names never deduplicate',
    );
    assert.ok(second.sourceStates.every((s) => !JSON.stringify(s).includes('PRIVATE')));
  } finally {
    f.close();
  }
});

test('adapter unavailable pages retry the same position rather than becoming exhausted', async () => {
  const { getReadingDiscovery } = await import('../server/catalog-aggregation.js');
  const { createContinuationStore } = await import('../server/reader-continuation.js');
  const f = contextFixture();
  const s = source(1);
  let time = 1000;
  const continuationStore = createContinuationStore(f.db, { now: () => time });
  const deps = {
    db: f.db,
    now: () => time,
    currentSources: [s],
    continuationStore,
    bridge: {
      async browse() {
        return {
          items: [],
          nextPage: null,
          hasMore: false,
          sourceState: {
            sourceId: s.id,
            state: 'unavailable',
            status: 429,
            reason: 'rate-limited',
            retryAt: new Date(time + 3000).toISOString(),
          },
        };
      },
    },
  };
  try {
    const result = await getReadingDiscovery({}, context, deps);
    assert.equal(result.hasMore, true);
    assert.ok(result.nextCursor);
    const state = await continuationStore.resume(result.nextCursor, context);
    assert.equal(state.positions[s.id].page, 1);
    assert.equal(state.positions[s.id].done, false);
  } finally {
    f.close();
  }
});

test('fresh adapter reclassification cannot be overwritten by an earlier safe inventory snapshot', async () => {
  const { getReadingDiscovery, getReadingSuggestions } = await import(
    '../server/catalog-aggregation.js'
  );
  const f = contextFixture();
  const s = source(1),
    changed = { ...s, classification: rating('mixed') };
  try {
    let change = false;
    const deps = {
      db: f.db,
      bridge: {
        async catalogs() {
          return { sources: [s], nextCursor: null };
        },
        async browse() {
          return {
            items: [{ ...title(change ? changed : s), classification: rating('safe') }],
            hasMore: false,
          };
        },
      },
    };
    assert.equal((await getReadingDiscovery({}, context, deps)).items.length, 1);
    change = true;
    const result = await getReadingDiscovery({}, context, deps);
    assert.deepEqual(result.items, []);
    assert.deepEqual((await getReadingSuggestions({ q: 'Same' }, context, deps)).items, []);
  } finally {
    f.close();
  }
});

test('filtered empty pages retain continuation and cached suggestions make no provider requests', async () => {
  const { getReadingDiscovery, getReadingSuggestions } = await import(
    '../server/catalog-aggregation.js'
  );
  const f = contextFixture();
  let calls = 0;
  const s = source(1),
    deps = {
      db: f.db,
      currentSources: [s],
      bridge: {
        async browse() {
          calls++;
          return {
            items: [{ ...title(s), classification: rating('adult') }],
            hasMore: true,
            nextPage: 2,
          };
        },
      },
    };
  try {
    const result = await getReadingDiscovery({}, context, deps);
    assert.deepEqual(result.items, []);
    assert.equal(result.hasMore, true);
    assert.ok(result.nextCursor);
    const before = calls;
    assert.deepEqual((await getReadingSuggestions({ q: 'Same' }, context, deps)).items, []);
    assert.equal(calls, before);
  } finally {
    f.close();
  }
});

test('a source beyond four inventory pages is reachable through a filtered-empty continuation', async () => {
  const { getReadingDiscovery } = await import('../server/catalog-aggregation.js');
  const f = contextFixture();
  const all = Array.from({ length: 601 }, (_, i) => source(i + 1));
  let writes = 0;
  const db = {
    ...f.db,
    run: async (sql, ...values) => {
      if (sql.startsWith('INSERT INTO reader_inventory_cache')) writes++;
      return f.db.run(sql, ...values);
    },
  };
  const deps = {
    db,
    bridge: {
      async catalogs({ cursor, limit }) {
        const n = Number(cursor || 0);
        return {
          sources: all.slice(n, n + limit),
          nextCursor: n + limit < all.length ? String(n + limit) : null,
        };
      },
      async browse({ sourceId }) {
        return { items: [title(all.find((s) => s.id === sourceId))], hasMore: false };
      },
    },
  };
  try {
    const first = await getReadingDiscovery({ source: 'suwayomi:601' }, context, deps);
    assert.equal(first.items.length, 0);
    assert.ok(first.nextCursor);
    assert.equal(writes, 4);
    const second = await getReadingDiscovery(
      { source: 'suwayomi:601', cursor: first.nextCursor },
      context,
      deps,
    );
    assert.equal(second.items.length, 1);
    assert.equal(second.items[0].sourceRef.id, 'suwayomi:601');
    assert.equal(writes, 7, 'one inventory write per page, never one source transaction per row');
  } finally {
    f.close();
  }
});

test('generic flag and current source policy precede public serialization and source states are sanitized', async () => {
  const { getReadingDiscovery } = await import('../server/catalog-aggregation.js');
  const f = contextFixture();
  let calls = 0;
  const s = source(1);
  const deps = {
    db: f.db,
    currentSources: [s],
    coreSearch: async () => ({
      items: [{ id: 'mal-manga-1', title: 'Core', category: 'MANGA', isAdult: false }],
      hasNextPage: false,
    }),
    bridge: {
      async browse() {
        calls++;
        return {
          items: [title(s)],
          hasMore: false,
          sourceState: {
            sourceId: s.id,
            state: 'ready',
            operation: 'popular',
            status: 200,
            reason: null,
            privateUrl: 'https://PRIVATE.invalid',
            retryAt: 'PRIVATE',
          },
        };
      },
    },
  };
  try {
    const disabled = await getReadingDiscovery(
      {},
      { ...context, integrationMode: 'all', extensionsEnabled: false },
      deps,
    );
    assert.equal(calls, 0);
    assert.equal(disabled.items.length, 1);
    assert.equal(disabled.items[0].readingState, 'metadata-only');
    assert.deepEqual(disabled.items[0].availableIntegrations, []);
    const enabled = await getReadingDiscovery({}, context, deps);
    assert.doesNotMatch(JSON.stringify(enabled), /PRIVATE/);
  } finally {
    f.close();
  }
});

test('only persisted equivalence merges cards while retaining both exact reading paths', async () => {
  const { getReadingDiscovery } = await import('../server/catalog-aggregation.js');
  const { createExternalCatalogStore } = await import('../server/external-catalog-store.js');
  const f = contextFixture(),
    sources = [source(1), source(2)],
    store = createExternalCatalogStore(f.db);
  try {
    const titles = await Promise.all(sources.map((s) => store.rememberTitle(title(s))));
    await store.addEquivalence(titles[0].id, titles[1].id, {
      kind: 'trusted-mapping',
      reference: 'fixture-exact-publisher-edition',
    });
    const result = await getReadingDiscovery({}, context, {
      db: f.db,
      currentSources: sources,
      bridge: {
        async browse({ sourceId }) {
          return { items: [title(sources.find((s) => s.id === sourceId))], hasMore: false };
        },
      },
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].readingChoices?.length, 2);
    assert.deepEqual(
      result.items[0].readingChoices.map((c) => c.mediaId).sort(),
      titles.map((t) => t.id).sort(),
    );
  } finally {
    f.close();
  }
});

test('deadline exhaustion rotates from the last attempted source without starving unattempted positions', async () => {
  const { getReadingDiscovery } = await import('../server/catalog-aggregation.js');
  const f = contextFixture(),
    sources = Array.from({ length: 8 }, (_, i) => source(i + 1));
  let time = 1000,
    attempted = [];
  const deps = {
    db: f.db,
    now: () => time,
    currentSources: sources,
    bridge: {
      async browse(input, op) {
        attempted.push(input.sourceId);
        if (attempted.length % 2 === 0) time = op.deadlineAt;
        return {
          items: [title(sources.find((s) => s.id === input.sourceId))],
          hasMore: true,
          nextPage: input.page + 1,
        };
      },
    },
  };
  try {
    const first = await getReadingDiscovery({}, context, deps);
    assert.equal(attempted.length, 2);
    await getReadingDiscovery({ cursor: first.nextCursor }, context, deps);
    assert.deepEqual(
      attempted,
      sources.slice(0, 4).map((s) => s.id),
    );
  } finally {
    f.close();
  }
});

function consumeFeedPage(cards, page) {
  for (const item of page.items) cards.set(item.id, item);
  for (const update of page.updates || []) {
    const card = cards.get(update.id);
    assert.ok(card, 'updates target a representative previously emitted in this selection');
    const choices = new Map((card.readingChoices || []).map((choice) => [choice.mediaId, choice]));
    for (const choice of update.readingChoices) choices.set(choice.mediaId, choice);
    cards.set(update.id, {
      ...card,
      readingChoices: [...choices.values()],
      availableIntegrations: [
        ...new Set([...choices.values()].map((choice) => choice.integration)),
      ],
    });
  }
}

for (const scenario of ['limited page', 'later four-operation batch'])
  test(`equivalent choices survive a ${scenario} as bounded updates to one representative`, async () => {
    const { getReadingDiscovery } = await import('../server/catalog-aggregation.js');
    const { createExternalCatalogStore } = await import('../server/external-catalog-store.js');
    const f = contextFixture(),
      count = scenario === 'limited page' ? 2 : 6,
      sources = Array.from({ length: count }, (_, i) => source(i + 1)),
      store = createExternalCatalogStore(f.db);
    let calls = 0;
    try {
      const firstTitle = await store.rememberTitle(title(sources[0]));
      const lastTitle = await store.rememberTitle(title(sources.at(-1)));
      await store.addEquivalence(firstTitle.id, lastTitle.id, {
        kind: 'trusted-mapping',
        reference: 'fixture-exact-cross-page-edition',
      });
      const deps = {
        db: f.db,
        currentSources: sources,
        bridge: {
          async browse({ sourceId }) {
            calls++;
            return {
              items:
                sourceId === sources[0].id || sourceId === sources.at(-1).id
                  ? [title(sources.find((s) => s.id === sourceId))]
                  : [],
              hasMore: false,
            };
          },
        },
      };
      const input = { limit: scenario === 'limited page' ? 1 : 20 };
      const first = await getReadingDiscovery(input, context, deps);
      assert.equal(first.items.length, 1);
      assert.equal(first.items[0].readingChoices.length, 1);
      assert.ok(first.nextCursor);
      const initialCalls = calls,
        cards = new Map();
      consumeFeedPage(cards, first);
      const second = await getReadingDiscovery(
        { ...input, cursor: first.nextCursor },
        context,
        deps,
      );
      assert.equal(
        second.items.length,
        0,
        'an equivalent path must not create another display card',
      );
      assert.equal(
        second.updates?.length,
        1,
        'later equivalent path needs an explicit merge update',
      );
      assert.equal(second.updates[0].id, first.items[0].id);
      assert.deepEqual(
        Object.keys(second.updates[0]).sort(),
        ['id', 'readingChoices'],
        'updates never reserialize old representative metadata',
      );
      assert.equal(
        second.hasMore,
        false,
        'terminal update-only pages still carry the new reading path',
      );
      consumeFeedPage(cards, second);
      consumeFeedPage(cards, second);
      assert.equal(cards.size, 1);
      assert.deepEqual(
        [...cards.values()][0].readingChoices.map((c) => c.mediaId).sort(),
        [firstTitle.id, lastTitle.id].sort(),
      );
      assert.ok(initialCalls <= 4);
      assert.ok(calls - initialCalls <= 4);
      if (scenario === 'later four-operation batch') {
        assert.equal(initialCalls, 4);
        assert.equal(calls, 6);
      }
      const row = await f.db.get('SELECT payload FROM reader_continuations');
      const state = JSON.parse(row.payload);
      assert.ok(Buffer.byteLength(row.payload) <= 1048576);
      assert.ok(
        Object.values(state.representatives).every((value) => typeof value === 'string'),
        'session retains only bounded identity mapping, not provider/card payloads',
      );
    } finally {
      f.close();
    }
  });

test('later inventory segment updates retain only the newly eligible exact path', async () => {
  const { getReadingDiscovery } = await import('../server/catalog-aggregation.js');
  const { createExternalCatalogStore } = await import('../server/external-catalog-store.js');
  const f = contextFixture(),
    original = source(1),
    later = source(601),
    store = createExternalCatalogStore(f.db);
  try {
    const firstTitle = await store.rememberTitle(title(original)),
      lastTitle = await store.rememberTitle(title(later));
    await store.addEquivalence(firstTitle.id, lastTitle.id, {
      kind: 'trusted-mapping',
      reference: 'fixture-exact-inventory-segment',
    });
    let calls = 0;
    const deps = {
      db: f.db,
      currentSources: [original],
      bridge: {
        async browse({ sourceId }) {
          calls++;
          const s = sourceId === original.id ? original : later;
          return { items: [title(s)], hasMore: s.id === original.id, nextPage: 2 };
        },
      },
    };
    const first = await getReadingDiscovery({}, context, deps);
    deps.currentSources = [later];
    const second = await getReadingDiscovery({ cursor: first.nextCursor }, context, deps);
    assert.equal(second.items.length, 0);
    assert.equal(second.updates.length, 1);
    assert.equal(second.updates[0].id, firstTitle.id);
    assert.deepEqual(
      second.updates[0].readingChoices.map((choice) => choice.mediaId),
      [lastTitle.id],
    );
    assert.ok(
      !JSON.stringify(second.updates).includes(original.id),
      'no old source snapshot is reserialized',
    );
    assert.equal(calls, 2, 'equivalence updates make no extra remote calls');
  } finally {
    f.close();
  }
});
