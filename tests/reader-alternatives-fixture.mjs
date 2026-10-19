import { contextFixture } from './reader-context-fixture.mjs';
import { createExternalCatalogStore } from '../server/external-catalog-store.js';
export const alternativeRating = (rating = 'safe') => ({
  rating,
  provenance: {
    sourceField: 'source.contentWarning',
    value: rating,
    checkedAt: '2026-10-19T00:00:00Z',
  },
});
export const alternativeSource = (id, providerKey = 'Weeb Central', rating = 'safe') => ({
  id: `suwayomi:${id}`,
  integration: 'suwayomi',
  upstreamSourceId: String(id),
  providerKey,
  language: 'en',
  classification: alternativeRating(rating),
  capabilities: Object.fromEntries(
    ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map((k) => [
      k,
      'supported',
    ]),
  ),
  bridgeInstance: 'fixture',
});
export function alternativeFixture() {
  const f = contextFixture(),
    core = new Map(),
    calls = [];
  const originalSource = alternativeSource('1', 'MangaDex'),
    targetSource = alternativeSource('2');
  const state = { sources: [originalSource, targetSource], failure: false, hook: null };
  const store = createExternalCatalogStore(f.db);
  const native = (source, key, metadata = {}) =>
    store.rememberTitle({
      sourceRef: source,
      upstreamRef: { sourceId: source.id, upstreamKey: key, language: source.language },
      classification: source.classification,
      metadata: {
        title: 'SECRET TITLE',
        cover: 'https://private.invalid/SECRET-COVER',
        ...metadata,
      },
    });
  const seedCore = async (id = 'mal-manga-21') => {
    const item = { id, category: 'MANGA', title: 'CORE TITLE' };
    core.set(id, item);
    await f.db.run(
      'INSERT OR REPLACE INTO catalog_media(id,payload,fetched_at) VALUES(?,?,?)',
      id,
      JSON.stringify(item),
      Date.now(),
    );
    return item;
  };
  const context = {
    destination: 'yoru',
    integrationMode: 'all',
    extensionsEnabled: true,
    overrides: { MangaDex: { yoru: false } },
    guestId: 'a'.repeat(64),
    selectionFingerprint: 'fixture',
  };
  const deps = {
    db: f.db,
    coreAccountMedia: async (ids) => {
      calls.push({ operation: 'core-cache', ids });
      return ids.map((id) => core.get(id)).filter(Boolean);
    },
    bridge: {
      catalogs: async (params, op) => {
        calls.push({ operation: 'catalogs', cursor: params.cursor, deadlineAt: op.deadlineAt });
        await state.hook?.();
        if (state.failure) throw Object.assign(new Error('SECRET PRIVATE URL'), { status: 503 });
        const start = Number(params.cursor || 0);
        return {
          sources: state.sources.slice(start, start + params.limit),
          nextCursor:
            start + params.limit < state.sources.length ? String(start + params.limit) : null,
        };
      },
      details: async () => {
        calls.push({ operation: 'FORBIDDEN-details' });
        throw new Error('No title calls');
      },
      browse: async () => {
        calls.push({ operation: 'FORBIDDEN-browse' });
        throw new Error('No feeds');
      },
      page: async () => {
        calls.push({ operation: 'FORBIDDEN-page' });
        throw new Error('No images');
      },
    },
  };
  return {
    ...f,
    core,
    calls,
    state,
    store,
    native,
    seedCore,
    context,
    deps,
    originalSource,
    targetSource,
    map: (a, b) =>
      store.addEquivalence(a.id, b.id, { kind: 'trusted-mapping', reference: 'reviewed-fixture' }),
  };
}
