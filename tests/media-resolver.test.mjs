import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextFixture } from './reader-context-fixture.mjs';
import { createExternalCatalogStore } from '../server/external-catalog-store.js';
const classification = (rating) => ({
  rating,
  provenance: {
    sourceField: 'source.contentWarning',
    value: rating,
    checkedAt: '2026-10-19T00:00:00Z',
  },
});
export const sourceFixture = (rating) => ({
  id: 'suwayomi:123',
  integration: 'suwayomi',
  upstreamSourceId: '123',
  providerKey: 'MangaDex',
  language: 'en',
  classification: classification(rating),
  bridgeInstance: 'fixture',
  capabilities: Object.fromEntries(
    ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map((k) => [
      k,
      'supported',
    ]),
  ),
});

test('Yoru denies adult native references before upstream bytes', async () => {
  const f = contextFixture();
  try {
    const { resolveMedia, resolveReadingEdition } = await import('../server/media-resolver.js');
    const { getReaderCover, getReaderChapter, getReaderPage } = await import(
      '../server/reading-sources.js'
    );
    const store = createExternalCatalogStore(f.db);
    let calls = 0;
    const bridge = Object.fromEntries(
      ['details', 'reader', 'page', 'cover'].map((k) => [
        k,
        async () => {
          calls++;
          throw new Error('private tunnel secret');
        },
      ]),
    );
    const context = {
      destination: 'yoru',
      integrationMode: 'all',
      overrides: {},
      extensionsEnabled: true,
    };
    const deps = {
      db: f.db,
      bridge,
      coreMedia: async () => {
        throw new Error('must never search core');
      },
    };
    for (const rating of ['adult', 'mixed', 'unknown']) {
      const media = await store.rememberTitle({
        sourceRef: sourceFixture(rating),
        upstreamRef: { sourceId: 'suwayomi:123', upstreamKey: `/title/${rating}`, language: 'en' },
        classification: classification(rating),
        metadata: { title: 'Same name', genres: ['Safe'] },
      });
      const edition = await store.rememberEdition(media.id, {
        sourceRef: media.sourceRef,
        upstreamRef: { title: media.upstreamRef, upstreamKey: '/chapter/1' },
        metadata: { number: '1', pages: 1 },
      });
      const options = { ...deps, readerDb: f.db, context, media: deps.coreMedia };
      await assert.rejects(resolveMedia(media.id, context, deps), { status: 404 });
      await assert.rejects(resolveReadingEdition(media.id, edition.id, context, deps), {
        status: 404,
      });
      for (const operation of [
        () => getReaderCover(media.id, options),
        () => getReaderChapter(media.id, edition.id, options),
        () => getReaderPage(media.id, edition.id, 0, options),
      ])
        await assert.rejects(operation, { status: 404 });
    }
    assert.equal(calls, 0);
  } finally {
    f.close();
  }
});

test('latest source classification, disabled membership and feature gate override stored safe snapshots; exact editions ignore discovery mode', async () => {
  const f = contextFixture();
  try {
    const { resolveMedia, resolveReadingEdition, assertMediaEligible } = await import(
      '../server/media-resolver.js'
    );
    const store = createExternalCatalogStore(f.db),
      source = sourceFixture('safe');
    const media = await store.rememberTitle({
      sourceRef: source,
      upstreamRef: { sourceId: source.id, upstreamKey: '/title/a', language: 'en' },
      classification: source.classification,
      metadata: { title: 'Same name' },
    });
    const edition = await store.rememberEdition(media.id, {
      sourceRef: source,
      upstreamRef: { title: media.upstreamRef, upstreamKey: '/chapter/a' },
      metadata: { number: '0.5' },
    });
    const context = {
        destination: 'yoru',
        integrationMode: 'core',
        overrides: {},
        extensionsEnabled: true,
      },
      deps = { db: f.db, coreMedia: async (id) => ({ id, title: 'Same name', category: 'MANGA' }) };
    assert.equal((await resolveMedia(media.id, context, deps)).id, media.id);
    assert.equal((await resolveReadingEdition(media.id, edition.id, context, deps)).id, edition.id);
    await assert.rejects(resolveReadingEdition('mal-manga-21', edition.id, context, deps), {
      status: 404,
    });
    assert.equal((await resolveMedia('mal-manga-21', context, deps)).id, 'mal-manga-21');
    await assert.rejects(
      resolveMedia(media.id, { ...context, overrides: { MangaDex: { yoru: false } } }, deps),
      { status: 404 },
    );
    await assert.rejects(resolveMedia(media.id, { ...context, extensionsEnabled: false }, deps), {
      status: 404,
    });
    await store.rememberSource({ ...source, classification: classification('mixed') });
    await assert.rejects(resolveMedia(media.id, context, deps), { status: 404 });
    assert.throws(
      () => assertMediaEligible({ ...media, sourceRef: sourceFixture('unknown') }, context),
      { status: 404 },
    );
    const ara = {
      ...context,
      destination: 'ara-ara',
      overrides: { MangaDex: { 'ara-ara': true } },
    };
    assert.equal((await resolveMedia(media.id, ara, deps)).id, media.id);
  } finally {
    f.close();
  }
});

test('late source reclassification denies metadata and images before bytes; native DTO strips private fields', async () => {
  const f = contextFixture();
  try {
    const { resolveMedia } = await import('../server/media-resolver.js');
    const { getReaderCover, getReaderPage, getReaderChapter } = await import(
      '../server/reading-sources.js'
    );
    const source = sourceFixture('safe'),
      store = createExternalCatalogStore(f.db);
    const title = {
      sourceRef: source,
      upstreamRef: { sourceId: source.id, upstreamKey: '/late/a', language: 'en' },
      classification: source.classification,
      metadata: {
        title: 'A',
        cover: 'https://private.trycloudflare.com/a',
        localMangaId: '123',
        privateUrl: 'secret',
      },
    };
    const media = await store.rememberTitle(title);
    const edition = await store.rememberEdition(media.id, {
      sourceRef: source,
      upstreamRef: { title: media.upstreamRef, upstreamKey: '/chapter/a' },
      metadata: { number: '1', pages: 1 },
    });
    let changed = false,
      bytes = 0;
    const bridge = {
      details: async () =>
        changed
          ? {
              ...title,
              sourceRef: { ...source, classification: classification('mixed') },
              classification: classification('mixed'),
            }
          : title,
      cover: async () => {
        bytes++;
        return { body: new Uint8Array([1]), type: 'image/png' };
      },
      page: async () => {
        bytes++;
        return { body: new Uint8Array([1]), type: 'image/png' };
      },
      reader: async () => ({
        edition: { sourceRef: source, upstreamRef: edition.upstreamRef, metadata: {} },
        pages: [0],
      }),
    };
    const context = {
      destination: 'yoru',
      integrationMode: 'core',
      overrides: {},
      extensionsEnabled: true,
    };
    const options = { readerDb: f.db, db: f.db, context, bridge };
    const publicMedia = await resolveMedia(media.id, context, { db: f.db, bridge });
    assert.equal(publicMedia.cover, `/api/media/${media.id}/cover?destination=yoru`);
    assert.doesNotMatch(
      JSON.stringify(publicMedia),
      /private.trycloudflare|localMangaId|privateUrl/,
    );
    const manifest = await getReaderChapter(media.id, edition.id, options);
    assert.equal(
      manifest.pages[0].url,
      `/api/media/${media.id}/reader/${edition.id}/page/0?destination=yoru`,
    );
    changed = true;
    for (const operation of [
      () => resolveMedia(media.id, context, { db: f.db, bridge }),
      () => getReaderCover(media.id, options),
      () => getReaderPage(media.id, edition.id, 0, options),
    ])
      await assert.rejects(operation, { status: 404 });
    assert.equal(bytes, 0);
  } finally {
    f.close();
  }
});

test('only verified title mappings expose additional exact adapter choices; same names and chapter numbers never alias owners', async () => {
  const f = contextFixture();
  try {
    const { resolveMedia } = await import('../server/media-resolver.js');
    const store = createExternalCatalogStore(f.db),
      source = sourceFixture('safe');
    const native = await store.rememberTitle({
      sourceRef: source,
      upstreamRef: { sourceId: source.id, upstreamKey: '/mapped/a', language: 'en' },
      classification: source.classification,
      metadata: { title: 'Same name' },
    });
    const context = {
      destination: 'yoru',
      integrationMode: 'all',
      overrides: {},
      extensionsEnabled: true,
    };
    let coreCalls = 0;
    const deps = {
      db: f.db,
      coreMedia: async (id) => {
        coreCalls++;
        return { id, title: 'Same name', category: 'MANGA' };
      },
    };
    assert.deepEqual((await resolveMedia(native.id, context, deps)).availableIntegrations, [
      'suwayomi',
    ]);
    assert.equal(coreCalls, 0);
    await f.db.run(
      'INSERT INTO catalog_media(id,payload,fetched_at) VALUES(?,?,?)',
      'mal-manga-21',
      '{}',
      Date.now(),
    );
    await store.addEquivalence(native.id, 'mal-manga-21', {
      kind: 'trusted-mapping',
      reference: 'reviewed-fixture',
    });
    const resolved = await resolveMedia(native.id, context, deps);
    assert.deepEqual(resolved.availableIntegrations, ['suwayomi', 'core']);
    assert.equal(resolved.readingChoices.length, 3);
    assert.equal(
      resolved.readingChoices.find((c) => c.integration === 'suwayomi').mediaId,
      native.id,
    );
    assert.deepEqual(
      resolved.readingChoices
        .filter((c) => c.integration === 'core')
        .map((c) => [c.mediaId, c.sourceRef.id]),
      [
        ['mal-manga-21', 'mangadex'],
        ['mal-manga-21', 'weebcentral'],
      ],
    );
    const core = await resolveMedia('mal-manga-21', context, deps);
    assert.equal(core.readingChoices.find((c) => c.integration === 'suwayomi').mediaId, native.id);
  } finally {
    f.close();
  }
});

test('resolver rejects a different returned core identity before exposing its metadata', async () => {
  const { resolveMedia } = await import('../server/media-resolver.js');
  await assert.rejects(
    resolveMedia(
      'mal-manga-21',
      { destination: 'yoru', overrides: {} },
      { coreMedia: async () => ({ id: 'mal-manga-99', category: 'MANGA' }) },
    ),
    { status: 404 },
  );
});

test('title genres never establish an independent safe classification for a mixed source', async () => {
  const { assertMediaEligible } = await import('../server/media-resolver.js');
  const source = sourceFixture('mixed');
  const media = {
    id: `ext-manga-${'c'.repeat(32)}`,
    sourceRef: source,
    classification: {
      rating: 'safe',
      provenance: {
        sourceField: 'title.genres',
        value: ['Adventure'],
        checkedAt: '2026-10-19T00:00:00Z',
      },
    },
  };
  assert.throws(
    () =>
      assertMediaEligible(media, { destination: 'yoru', overrides: {}, extensionsEnabled: true }),
    { status: 404 },
  );
});

test('chapter and manifest responses revalidate a newly changed source classification before serialization', async () => {
  const f = contextFixture();
  try {
    const { getReaderChapter, getReadingCatalog, getReadingChapter } = await import(
      '../server/reading-sources.js'
    );
    const store = createExternalCatalogStore(f.db),
      source = sourceFixture('safe');
    const title = {
      sourceRef: source,
      upstreamRef: { sourceId: source.id, upstreamKey: '/race/a', language: 'en' },
      classification: source.classification,
      metadata: { title: 'A' },
    };
    const media = await store.rememberTitle(title);
    const input = {
      sourceRef: source,
      upstreamRef: { title: media.upstreamRef, upstreamKey: '/race/chapter' },
      metadata: { number: '1', pages: 1 },
    };
    const edition = await store.rememberEdition(media.id, input);
    const changed = {
      ...input,
      sourceRef: { ...source, classification: { ...source.classification, rating: 'mixed' } },
    };
    const options = {
      readerDb: f.db,
      db: f.db,
      context: {
        destination: 'yoru',
        integrationMode: 'all',
        overrides: {},
        extensionsEnabled: true,
      },
      bridge: {
        details: async () => title,
        reader: async () => ({ edition: changed, pages: [0] }),
        chapter: async () => changed,
        chapters: async () => ({ items: [changed] }),
      },
    };
    for (const operation of [
      () => getReaderChapter(media.id, edition.id, options),
      () => getReadingChapter(media.id, edition.id, options),
      () => getReadingCatalog(media.id, {}, options),
    ]) {
      await store.rememberSource(source);
      // A chapter response cannot replace the request-start source policy.
      await assert.rejects(operation, { status: 409 });
      assert.equal(
        (await store.getSourceAuthority(source.id)).source.classification.rating,
        'safe',
      );
    }
  } finally {
    f.close();
  }
});
