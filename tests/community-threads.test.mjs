import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getCommunityThreads } from '../server/community-threads.js';
import { contextFixture } from './reader-context-fixture.mjs';
import { accountSource } from './extension-account-contract.mjs';
import { createExternalCatalogStore } from '../server/external-catalog-store.js';
import { createSocialPolicy } from '../server/native-social-policy.js';
const now = Date.parse('2026-10-18T18:00:00Z');
const anime = { id: 'mal-anime-52991', category: 'ANIME', title: 'Frieren' };
const manga = { id: 'mal-manga-1', category: 'MANGA', title: 'Manga' };
const manhwa = { id: 'mal-manga-2', category: 'MANHWA', type: 'MANGA', title: 'Manhwa' };
test('native chapter zero stays separate from title zero and numbered threads require edition equivalence', async (t) => {
  const f = contextFixture();
  t.after(f.close);
  await f.db.run(
    "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('one','One','edition@fixture','x','now')",
  );
  const source = accountSource(),
    store = createExternalCatalogStore(f.db),
    editions = [];
  for (let i = 0; i < 2; i++) {
    const upstreamRef = { sourceId: source.id, upstreamKey: `/edition-title/${i}`, language: 'en' };
    const media = await store.rememberTitle({
      sourceRef: source,
      upstreamRef,
      classification: source.classification,
      metadata: { title: 'Same title', category: 'MANGA' },
    });
    const chapter = await store.rememberEdition(media.id, {
      sourceRef: source,
      upstreamRef: { title: upstreamRef, upstreamKey: '/chapter/0' },
      metadata: { number: '0' },
    });
    editions.push(chapter);
    await f.db.run(
      'INSERT INTO comments(id,user_id,media_id,unit,edition_id,body,created_at) VALUES(?,?,?,?,?,?,?)',
      `chapter-${i}`,
      'one',
      media.id,
      0,
      chapter.id,
      'Chapter',
      '2026-10-18T01:00:00Z',
    );
    if (!i)
      await f.db.run(
        'INSERT INTO comments(id,user_id,media_id,unit,body,created_at) VALUES(?,?,?,?,?,?)',
        'whole-title',
        'one',
        media.id,
        0,
        'Title',
        '2026-10-18T01:00:00Z',
      );
  }
  const policy = await createSocialPolicy(
    { destination: 'yoru', extensionsEnabled: true, overrides: {}, revision: 0 },
    {
      db: f.db,
      coreAccountMedia: async () => [],
      refreshSources: async () => ({ currentSources: [source], complete: true, sourceStates: [] }),
    },
  );
  const options = { db: f.db, policy, chapters: async () => ({ items: [], state: 'ready' }), now };
  const first = await getCommunityThreads({ category: 'manga' }, options);
  assert.equal(first.items.length, 3);
  assert.equal(first.items.filter((x) => x.editionId).length, 2);
  await store.addEquivalence(editions[0].id, editions[1].id, {
    kind: 'trusted-mapping',
    reference: 'verified-exact-chapter',
  });
  const second = await getCommunityThreads({ category: 'manga' }, options);
  assert.equal(second.items.length, 2);
  assert.equal(second.items.find((x) => x.editionId).comments, 2);
});
test('only verified exact title equivalence combines whole-title discussion presentation', async (t) => {
  const f = contextFixture();
  t.after(f.close);
  await f.db.run(
    "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('one','One','one@fixture','x','now')",
  );
  const source = accountSource(),
    store = createExternalCatalogStore(f.db),
    titles = [];
  for (let i = 0; i < 2; i++) {
    const media = await store.rememberTitle({
      sourceRef: source,
      upstreamRef: { sourceId: source.id, upstreamKey: `/same-name/${i}`, language: 'en' },
      classification: source.classification,
      metadata: { title: 'Same title text', category: 'MANGA' },
    });
    titles.push(media);
    await f.db.run(
      'INSERT INTO comments(id,user_id,media_id,unit,body,created_at) VALUES(?,?,?,?,?,?)',
      `equivalent-${i}`,
      'one',
      media.id,
      0,
      'Original row',
      '2026-10-18T01:00:00Z',
    );
  }
  const policy = await createSocialPolicy(
    { destination: 'yoru', extensionsEnabled: true, overrides: {}, revision: 0 },
    {
      db: f.db,
      coreAccountMedia: async () => [],
      refreshSources: async () => ({ currentSources: [source], complete: true, sourceStates: [] }),
    },
  );
  const options = { db: f.db, policy, chapters: async () => ({ items: [], state: 'ready' }), now };
  assert.equal((await getCommunityThreads({ category: 'manga' }, options)).items.length, 2);
  await store.addEquivalence(titles[0].id, titles[1].id, {
    kind: 'trusted-mapping',
    reference: 'reviewed-exact-title-evidence',
  });
  const result = await getCommunityThreads({ category: 'manga' }, options);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].comments, 2);
  assert.equal(result.items[0].discussions.length, 2);
  assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM comments')).n, 2);
});
test('native undated title discussion is discoverable without fabricating a release date', async (t) => {
  const f = contextFixture();
  t.after(f.close);
  await f.db.run(
    "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('one','One','one@fixture','x','now')",
  );
  const source = accountSource(),
    store = createExternalCatalogStore(f.db);
  const media = await store.rememberTitle({
    sourceRef: source,
    upstreamRef: { sourceId: source.id, upstreamKey: '/undated', language: 'en' },
    classification: source.classification,
    metadata: { title: 'Undated title', category: 'MANGA' },
  });
  await f.db.run(
    "INSERT INTO comments(id,user_id,media_id,unit,body,created_at) VALUES('c','one',?,0,'Hello','2026-10-18T01:00:00Z')",
    media.id,
  );
  const policy = await createSocialPolicy(
    {
      destination: 'yoru',
      integrationMode: 'core',
      extensionsEnabled: true,
      overrides: {},
      revision: 0,
      selectionFingerprint: 'fixture',
    },
    {
      db: f.db,
      coreAccountMedia: async () => [],
      refreshSources: async () => ({ currentSources: [source], complete: true, sourceStates: [] }),
    },
  );
  const result = await getCommunityThreads(
    { category: 'manga' },
    {
      db: f.db,
      policy,
      media: async () => {
        throw new Error('No per-title provider fanout');
      },
      chapters: async () => ({ items: [], state: 'ready' }),
      now,
    },
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].mediaId, media.id);
  assert.equal(result.items[0].unit, 0);
  assert.equal(result.items[0].releasedAt, null);
  assert.equal(result.items[0].comments, 1);
});
function setup(t) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE comments (media_id TEXT, unit INTEGER, created_at TEXT)');
  t.after(() => sql.close());
  return {
    now,
    db: { all: (query, ...args) => sql.prepare(query).all(...args) },
    media: async (id) => [anime, manga, manhwa].find((x) => x.id === id),
    insert: (id, unit, date = '2026-10-17T10:00:00Z') =>
      sql.prepare('INSERT INTO comments VALUES (?,?,?)').run(id, unit, date),
  };
}
test('release threads exist before comments and merge languages with exact shared comment counts', async (t) => {
  const options = setup(t);
  options.insert(anime.id, 4);
  options.insert(anime.id, 4);
  options.insert(anime.id, 0);
  options.insert(anime.id, 2);
  options.home = async () => ({
    state: 'ready',
    releases: [
      { media: anime, episode: 4, airingAt: '2026-10-18T01:00:00Z' },
      { media: anime, episode: 4, airingAt: '2026-10-18T02:00:00Z' },
      { media: anime, episode: 5, airingAt: '2026-10-18T03:00:00Z' },
      { media: anime, episode: 6, airingAt: '2026-10-19T03:00:00Z' },
      { media: anime, episode: 7, airingAt: '2026-10-17T03:00:00Z', delayed: true },
      { media: { ...anime, id: null }, episode: 8, airingAt: '2026-10-17T03:00:00Z' },
    ],
  });
  const result = await getCommunityThreads({ category: 'anime' }, options);
  assert.deepEqual(result.items.map((x) => x.unit).sort(), [2, 4, 5]);
  assert.equal(result.items.find((x) => x.unit === 4).comments, 2);
  assert.equal(result.items.find((x) => x.unit === 5).comments, 0);
  assert.equal(result.items[0].id, `${anime.id}:5`);
});
test('chapter translations share one thread while manga/manhwa, future and fractional chapters stay separate', async (t) => {
  const options = setup(t);
  options.insert(manga.id, 3);
  options.insert(manhwa.id, 9);
  options.chapters = async () => ({
    state: 'ready',
    items: [
      {
        mediaId: manga.id,
        title: manga.title,
        chapter: '4',
        publishedAt: '2026-10-18T01:00:00Z',
        status: 'released',
      },
      {
        mediaId: manga.id,
        title: manga.title,
        chapter: '4.5',
        publishedAt: '2026-10-18T01:00:00Z',
        status: 'released',
      },
      {
        mediaId: manga.id,
        title: manga.title,
        chapter: '5',
        publishedAt: '2026-10-19T01:00:00Z',
        status: 'scheduled',
      },
      {
        mediaId: null,
        title: 'Unmapped',
        chapter: '1',
        publishedAt: '2026-10-18T01:00:00Z',
        status: 'released',
      },
    ],
  });
  const result = await getCommunityThreads({ category: 'manga' }, options);
  assert.deepEqual(result.items.map((x) => x.unit).sort(), [3, 4]);
  assert.ok(result.items.every((x) => x.mediaId === manga.id));
});
test('provider outages preserve existing conversations', async (t) => {
  const options = setup(t);
  options.insert(anime.id, 10);
  options.home = async () => {
    throw new Error('offline');
  };
  const result = await getCommunityThreads({}, options);
  assert.equal(result.releaseState, 'unavailable');
  assert.equal(result.items[0].unit, 10);
  assert.equal(result.items[0].comments, 1);
});
for (const chapter of [false, true]) {
  test(`transitive exact ${chapter ? 'edition' : 'title'} mappings retain all discussion aliases`, async (t) => {
    const f = contextFixture();
    t.after(f.close);
    await f.db.run(
      "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('chain','Chain','chain@fixture','x','now')",
    );
    const source = accountSource(),
      store = createExternalCatalogStore(f.db),
      originals = [];
    for (let i = 0; i < 3; i++) {
      const upstreamRef = { sourceId: source.id, upstreamKey: `/chain/${i}`, language: 'en' };
      const media = await store.rememberTitle({
        sourceRef: source,
        upstreamRef,
        classification: source.classification,
        metadata: { title: 'Same title', category: 'MANGA' },
      });
      const edition = chapter
        ? await store.rememberEdition(media.id, {
            sourceRef: source,
            upstreamRef: { title: upstreamRef, upstreamKey: '/chapter/0' },
            metadata: { number: '0' },
          })
        : null;
      originals.push({ mediaId: media.id, unit: 0, editionId: edition?.id || null });
      await f.db.run(
        'INSERT INTO comments(id,user_id,media_id,unit,edition_id,body,created_at) VALUES(?,?,?,?,?,?,?)',
        `chain-${i}`,
        'chain',
        media.id,
        0,
        edition?.id || null,
        'Original',
        '2026-10-18T01:00:00Z',
      );
    }
    originals.sort((a, b) =>
      `${a.mediaId}:${a.editionId || 0}`.localeCompare(`${b.mediaId}:${b.editionId || 0}`),
    );
    for (let i = 0; i < 2; i++)
      await store.addEquivalence(
        originals[i].editionId || originals[i].mediaId,
        originals[i + 1].editionId || originals[i + 1].mediaId,
        { kind: 'trusted-mapping', reference: 'verified-chain' },
      );
    const policy = await createSocialPolicy(
      { destination: 'yoru', extensionsEnabled: true, overrides: {}, revision: 0 },
      {
        db: f.db,
        coreAccountMedia: async () => [],
        refreshSources: async () => ({
          currentSources: [source],
          complete: true,
          sourceStates: [],
        }),
      },
    );
    const options = {
      db: f.db,
      policy,
      chapters: async () => ({ items: [], state: 'ready' }),
      now,
    };
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = await getCommunityThreads({ category: 'manga' }, options);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].comments, 3);
      assert.deepEqual(result.items[0].discussions, originals);
      assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM comments')).n, 3);
    }
  });
}
