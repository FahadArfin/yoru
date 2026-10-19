import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextFixture } from './reader-context-fixture.mjs';
import { accountSource } from './extension-account-contract.mjs';
import { createExternalCatalogStore } from '../server/external-catalog-store.js';
import { createSocialPolicy, liveSocialPolicy } from '../server/native-social-policy.js';
import { discussionReference } from '../shared/native-social-contract.js';
import { resolveReaderContext } from '../server/reader-context.js';
import { readSocialEvents } from '../server/native-social-events.js';

test('direct uncached core lookup resolves once while batch lists stay cache-only', async (t) => {
  const f = contextFixture();
  t.after(f.close);
  const cache = [];
  let lookups = 0;
  const policy = await createSocialPolicy(
    { destination: 'yoru', extensionsEnabled: false, overrides: {}, revision: 0 },
    {
      db: f.db,
      coreAccountMedia: async () => cache,
      coreMedia: async (id) => {
        lookups++;
        const media = { id, title: 'Direct core', category: 'MANGA' };
        cache.push(media);
        return media;
      },
    },
  );
  assert.equal((await policy.mediaBatch(['mal-manga-999999'])).size, 0);
  await assert.rejects(policy.media('mal-manga-999999', { direct: false }), { status: 404 });
  assert.equal(lookups, 0);
  assert.equal((await policy.media('mal-manga-999999')).id, 'mal-manga-999999');
  assert.equal(lookups, 1);
});
test('core social metadata excludes private source fields and private cover URLs', async (t) => {
  const f = contextFixture();
  t.after(f.close);
  const policy = await createSocialPolicy(
    { destination: 'yoru', extensionsEnabled: false, overrides: {}, revision: 0 },
    {
      db: f.db,
      coreAccountMedia: async () => [
        {
          id: 'mal-manga-1',
          title: 'Core',
          category: 'MANGA',
          cover: 'http://127.0.0.1/private.jpg',
          sourceUrl: 'http://private.invalid/token',
          bridgeKey: 'secret',
        },
      ],
    },
  );
  const media = await policy.media('mal-manga-1');
  assert.equal(media.cover, '');
  assert.equal(media.sourceUrl, undefined);
  assert.equal(media.bridgeKey, undefined);
});

test('poll event limits follow eligibility and retain a cursor across hidden rows', async (t) => {
  const f = contextFixture();
  t.after(f.close);
  for (let i = 0; i < 105; i++)
    await f.db.run(
      'INSERT INTO event_log(event,payload,created_at) VALUES(?,?,?)',
      'comments',
      JSON.stringify({ mediaId: 'mal-manga-1' }),
      i,
    );
  await f.db.run(
    'INSERT INTO event_log(event,payload,created_at) VALUES(?,?,?)',
    'comments',
    JSON.stringify({ mediaId: 'mal-manga-2' }),
    106,
  );
  const policy = await createSocialPolicy(
    { destination: 'yoru', extensionsEnabled: false, overrides: {}, revision: 0 },
    {
      db: f.db,
      coreAccountMedia: async () => [
        { id: 'mal-manga-1', category: 'MANGA', title: 'Hidden', isAdult: true },
        { id: 'mal-manga-2', category: 'MANGA', title: 'Visible' },
      ],
    },
  );
  const result = await readSocialEvents({ policy, db: f.db, cursor: 0 });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].data.mediaId, 'mal-manga-2');
  assert.equal(result.cursor, 106);
});

test('bounded social scans expose a usable continuation instead of starving older eligible titles', async (t) => {
  const f = contextFixture();
  t.after(f.close);
  await f.db.run('CREATE TABLE social_fixture(media_id TEXT,sort INTEGER)');
  await f.db.run(
    "WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM x WHERE n<5000) INSERT INTO social_fixture SELECT 'mal-manga-'||n,n FROM x",
  );
  await f.db.run("INSERT INTO social_fixture VALUES('mal-manga-9999999',5001)");
  let clock = 1000;
  const context = {
    destination: 'yoru',
    extensionsEnabled: false,
    overrides: {},
    revision: 0,
    selectionFingerprint: 'fixture',
  };
  const deps = {
    db: f.db,
    now: () => clock,
    coreAccountMedia: async (ids) => {
      clock += 12001;
      return ids.includes('mal-manga-9999999')
        ? [{ id: 'mal-manga-9999999', title: 'Older eligible title', category: 'MANGA' }]
        : [];
    },
  };
  const query = {
    candidates: 'SELECT media_id,media_id AS social_id,sort AS social_sort FROM social_fixture',
    orderBy: [
      ['social_sort', 'ASC'],
      ['social_id', 'ASC'],
    ],
    limit: 2,
  };
  const first = await (await createSocialPolicy(context, deps)).select(query);
  assert.equal(first.rows.length, 0);
  assert.equal(first.complete, false);
  assert.ok(first.nextCursor);
  const next = await (
    await createSocialPolicy(context, deps, { cursor: first.nextCursor })
  ).select(query);
  assert.deepEqual(
    next.rows.map((row) => row.media_id),
    ['mal-manga-9999999'],
  );
  assert.equal(next.complete, true);
  assert.equal(next.nextCursor, null);
});

test('social authorization rejects a session revoked during source inventory', async (t) => {
  const f = contextFixture();
  t.after(f.close);
  await f.db.run(
    "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('one','One','one@fixture','x','now')",
  );
  await f.db.run(
    'INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',
    'session',
    'one',
    'now',
    Date.now() + 60000,
  );
  const context = await resolveReaderContext(
    { destination: 'yoru' },
    { db: f.db, userId: 'one', sessionHash: 'session', extensionsEnabled: true },
  );
  await assert.rejects(
    createSocialPolicy(context, {
      db: f.db,
      coreAccountMedia: async () => [],
      refreshSources: async () => {
        await f.db.run('DELETE FROM sessions');
        return { currentSources: [], complete: true };
      },
    }),
    { status: 401 },
  );
});

test('live policy expires inventory proof and coalesces bounded refresh before delivery', async () => {
  let now = 0,
    calls = 0,
    release;
  const live = liveSocialPolicy(
    async () => {
      calls++;
      if (calls === 2)
        await new Promise((resolve) => {
          release = resolve;
        });
      return { current: async () => {}, marker: calls };
    },
    { now: () => now },
  );
  assert.equal((await live.delivery()).marker, 1);
  now = 59999;
  assert.equal((await live.delivery()).marker, 1);
  now = 60000;
  let delivered = false;
  const first = live.delivery().then((p) => {
    delivered = true;
    return p;
  });
  const second = live.delivery();
  await Promise.resolve();
  assert.equal(delivered, false);
  assert.equal(calls, 2);
  release();
  assert.equal((await first).marker, 2);
  assert.equal((await second).marker, 2);
});

test('native chapter zero and title discussion have distinct exact identities', () => {
  const id = `ext-manga-${'a'.repeat(32)}`,
    chapter = `ext-chapter-${'b'.repeat(32)}`;
  assert.equal(discussionReference(id, 1), null);
  assert.equal(discussionReference(id, 0).isTitle, true);
  assert.equal(discussionReference(id, 0, chapter).isTitle, false);
  assert.equal(discussionReference(id, 0.5, chapter).editionId, chapter);
  assert.equal(discussionReference('mal-manga-1', 1, chapter), null);
});

test('chapter activity rejects equal-number wrong-title editions without writes', async (t) => {
  const f = contextFixture();
  t.after(f.close);
  const { recordChapterOpen, rateChapter } = await import('../server/chapter-activity.js');
  await f.db.run(
    "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('one','One','one@fixture','x','now')",
  );
  await f.db.run(
    'INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',
    'session',
    'one',
    'now',
    Date.now() + 60000,
  );
  const source = accountSource(),
    store = createExternalCatalogStore(f.db);
  const inputs = [1, 2].map((i) => ({
    sourceRef: source,
    upstreamRef: { sourceId: source.id, upstreamKey: `/title/${i}`, language: 'en' },
    classification: source.classification,
    metadata: { title: `Title ${i}`, category: 'MANGA' },
  }));
  const titles = await Promise.all(inputs.map((input) => store.rememberTitle(input)));
  const chapter = await store.rememberEdition(titles[1].id, {
    sourceRef: source,
    upstreamRef: { title: inputs[1].upstreamRef, upstreamKey: '/chapter/1' },
    metadata: { number: '1', pages: 2 },
  });
  const options = {
    db: f.db,
    readerDb: f.db,
    userId: 'one',
    sessionHash: 'session',
    context: {
      destination: 'yoru',
      integrationMode: 'core',
      extensionsEnabled: true,
      overrides: {},
    },
    bridge: {
      details: async () => inputs[0],
      chapter: async () => {
        throw new Error('Wrong title must fail before chapter fetch');
      },
    },
  };
  await assert.rejects(recordChapterOpen(titles[0].id, chapter.id, null, options), { status: 404 });
  await assert.rejects(rateChapter(titles[0].id, chapter.id, 5, options), { status: 404 });
  assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM chapter_opens')).n, 0);
  assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM chapter_ratings')).n, 0);
});

test('native room and discussion eligibility applies to lists and direct lookup before LIMIT', async (t) => {
  const f = contextFixture();
  t.after(f.close);
  const sources = [accountSource('123', 'adult'), accountSource('124', 'safe')];
  const store = createExternalCatalogStore(f.db),
    titles = [];
  await f.db.run('CREATE TABLE social_fixture(media_id TEXT,sort INTEGER)');
  for (let i = 0; i < 65; i++) {
    const source = sources[i < 63 ? 0 : 1];
    const media = await store.rememberTitle({
      sourceRef: source,
      upstreamRef: { sourceId: source.id, upstreamKey: `/title/${i}`, language: 'en' },
      classification: source.classification,
      metadata: { title: `Title ${i}`, category: 'MANGA', cover: 'http://private/cover' },
    });
    titles.push(media);
    await f.db.run('INSERT INTO social_fixture VALUES(?,?)', media.id, i);
  }
  let inventories = 0;
  const deps = {
    db: f.db,
    coreAccountMedia: async () => [],
    refreshSources: async () => {
      inventories++;
      return { currentSources: sources, complete: true, sourceStates: [], nextCursor: null };
    },
  };
  const context = {
    destination: 'yoru',
    integrationMode: 'core',
    extensionsEnabled: true,
    overrides: {},
    revision: 0,
    selectionFingerprint: 'fixture',
  };
  const policy = await createSocialPolicy(context, deps);
  const result = await policy.select({
    candidates: 'SELECT media_id,media_id AS social_id,sort AS social_sort FROM social_fixture',
    orderBy: [
      ['social_sort', 'ASC'],
      ['social_id', 'ASC'],
    ],
    limit: 2,
  });
  assert.deepEqual(
    result.rows.map((r) => r.media_id),
    titles.slice(63).map((m) => m.id),
  );
  assert.equal(inventories, 1);
  await assert.rejects(policy.media(titles[0].id), { status: 404 });
  const media = await policy.media(titles[63].id);
  assert.match(media.cover, /^\/api\/media\/.+destination=yoru$/);
  assert.equal(inventories, 1, 'direct and list share one source inventory');
  await assert.rejects(policy.room({ media_id: media.id, destination: 'ara-ara' }), {
    status: 404,
  });
  assert.equal(
    (await f.db.all('SELECT * FROM social_fixture')).length,
    65,
    'hidden records survive',
  );
});

test('current inventory and classification changes fail closed; exact pinned mode stays eligible', async (t) => {
  const f = contextFixture();
  t.after(f.close);
  const source = accountSource(),
    store = createExternalCatalogStore(f.db);
  const media = await store.rememberTitle({
    sourceRef: source,
    upstreamRef: { sourceId: source.id, upstreamKey: '/policy', language: 'en' },
    classification: source.classification,
    metadata: { title: 'Pinned', category: 'MANGA' },
  });
  const context = {
    destination: 'yoru',
    integrationMode: 'core',
    extensionsEnabled: true,
    overrides: {},
    revision: 0,
    selectionFingerprint: 'fixture',
  };
  const deps = {
    db: f.db,
    coreAccountMedia: async () => [],
    refreshSources: async () => ({ currentSources: [source], complete: true, sourceStates: [] }),
  };
  assert.equal((await (await createSocialPolicy(context, deps)).media(media.id)).id, media.id);
  source.classification = { ...source.classification, rating: 'adult' };
  await assert.rejects((await createSocialPolicy(context, deps)).media(media.id), { status: 404 });
  const absent = await createSocialPolicy(context, {
    ...deps,
    refreshSources: async () => ({
      currentSources: [],
      complete: false,
      sourceStates: [{ state: 'unavailable' }],
    }),
  });
  await assert.rejects(absent.media(media.id), { status: 404 });
  assert.equal((await absent.status()).complete, false);
});

test('social writes recheck current title classification atomically after authorization', async (t) => {
  const f = contextFixture();
  t.after(f.close);
  const source = accountSource(),
    store = createExternalCatalogStore(f.db);
  const media = await store.rememberTitle({
    sourceRef: source,
    upstreamRef: { sourceId: source.id, upstreamKey: '/race', language: 'en' },
    classification: source.classification,
    metadata: { title: 'Race', category: 'MANGA' },
  });
  const policy = await createSocialPolicy(
    { destination: 'yoru', extensionsEnabled: true, overrides: {}, revision: 0 },
    {
      db: f.db,
      coreAccountMedia: async () => [],
      refreshSources: async () => ({ currentSources: [source], complete: true, sourceStates: [] }),
    },
  );
  await policy.media(media.id);
  await f.db.run('CREATE TABLE mutation_fixture(id TEXT)');
  await f.db.run(
    "UPDATE external_media SET classification=json_set(classification,'$.rating','adult') WHERE id=?",
    media.id,
  );
  await assert.rejects(
    policy.atomic([
      { sql: "INSERT INTO mutation_fixture VALUES('must-not-write') RETURNING id", values: [] },
    ]),
    { status: 404 },
  );
  assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM mutation_fixture')).n, 0);
});
