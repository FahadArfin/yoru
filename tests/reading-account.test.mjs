import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextFixture } from './reader-context-fixture.mjs';
import { createExternalCatalogStore } from '../server/external-catalog-store.js';
import { accountSource } from './extension-account-contract.mjs';
import { DatabaseSync } from 'node:sqlite';
import { externalCatalogSchema } from '../server/external-catalog-store.js';
import { nodeReaderDb } from '../server/reader-db.js';

test('trusted Node core equivalence uses the actual cache accessor without inventing SQL catalog tables', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(externalCatalogSchema);
  const db = nodeReaderDb({
    get: (sql, ...v) => sqlite.prepare(sql).get(...v),
    all: (sql, ...v) => sqlite.prepare(sql).all(...v),
    run: (sql, ...v) => sqlite.prepare(sql).run(...v),
    transaction: (fn) => {
      sqlite.exec('BEGIN');
      try {
        const result = fn();
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  });
  try {
    const { coreAccountMedia } = await import('../server/catalog-core.js');
    const source = accountSource(),
      store = createExternalCatalogStore(db, { coreAccountMedia });
    const media = await store.rememberTitle({
      sourceRef: source,
      upstreamRef: { sourceId: source.id, upstreamKey: '/exact/core-map', language: 'en' },
      classification: source.classification,
      metadata: { title: 'Known title', category: 'MANGA' },
    });
    assert.equal(
      (
        await db.all(
          "SELECT name FROM sqlite_master WHERE name IN ('catalog_media','imported_media')",
        )
      ).length,
      0,
    );
    await store.addEquivalence(media.id, 'mal-manga-21', {
      kind: 'trusted-mapping',
      reference: 'owner-reviewed-exact-mapping',
    });
    assert.equal((await store.getEquivalences(media.id))[0].rightId, 'mal-manga-21');
    await assert.rejects(
      store.addEquivalence(media.id, 'mal-manga-999999999', {
        kind: 'trusted-mapping',
        reference: 'unknown-not-proof',
      }),
      { status: 409 },
    );
  } finally {
    sqlite.close();
  }
});

test('portable core account metadata uses verified cache without upstream title lookups', async () => {
  const core = await import('../server/catalog-core.js');
  assert.equal(typeof core.coreAccountMedia, 'function');
  const items = await core.coreAccountMedia([
    'mal-manga-21',
    'mal-anime-52991',
    'mal-manga-999999999',
    'ext-manga-' + 'a'.repeat(32),
  ]);
  assert.ok(items.some((m) => m.id === 'mal-manga-21' && m.title));
  assert.ok(items.some((m) => m.id === 'mal-anime-52991' && m.title));
  assert.equal(
    items.some((m) => m.id === 'mal-manga-999999999'),
    false,
    'unknown MAL prefix is not metadata proof',
  );
});

test('account snapshots are bounded title records rather than unbounded provider detail payloads', async () => {
  const { accountSnapshotStatement } = await import('../server/reading-account.js');
  const statement = accountSnapshotStatement(
    { userId: 'one', destination: 'yoru' },
    {
      id: 'mal-manga-21',
      title: 'Saved title',
      category: 'MANGA',
      isAdult: false,
      description: 'x'.repeat(200000),
      readingChoices: Array.from({ length: 1000 }, () => ({
        privateUrl: 'http://private-provider/',
      })),
    },
  );
  const metadata = statement.values[4];
  assert.ok(Buffer.byteLength(metadata) <= 131072);
  assert.equal(JSON.parse(metadata).title, 'Saved title');
  assert.equal(JSON.parse(metadata).readingChoices, undefined);
});

test('native account views filter before pagination without deleting history', async () => {
  const account = await import('../server/reading-account.js');
  const f = contextFixture();
  try {
    await f.db.run(
      "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('owner','Owner','owner@fixture','x','now'),('other','Other','other@fixture','x','now')",
    );
    f.db.run(account.readingAccountSchema);
    const store = createExternalCatalogStore(f.db),
      ids = [];
    for (let i = 0; i < 7; i++) {
      const source = accountSource(String(100 + i), i < 3 ? 'adult' : 'safe');
      const media = await store.rememberTitle({
        sourceRef: source,
        upstreamRef: { sourceId: source.id, upstreamKey: `/title/${i}`, language: 'en' },
        classification: source.classification,
        metadata: { title: `Title ${i}`, category: 'MANGA' },
      });
      ids.push(media.id);
      await f.db.run(
        'INSERT INTO library(user_id,media_id,favorite,status,progress,updated_at) VALUES(?,?,0,?,8,?)',
        'owner',
        media.id,
        'reading',
        String(100 - i),
      );
    }
    const context = {
      userId: 'owner',
      destination: 'yoru',
      integrationMode: 'core',
      extensionsEnabled: true,
      overrides: {},
      selectionFingerprint: 'fixture',
      revision: 0,
    };
    const deps = {
      db: f.db,
      refreshSources: async () => ({
        currentSources: Array.from({ length: 7 }, (_, i) =>
          accountSource(String(100 + i), i < 3 ? 'adult' : 'safe'),
        ),
        complete: true,
        sourceStates: [],
        nextCursor: null,
      }),
      coreAccountMedia: async () => [],
    };
    const page = await account.listReadingLibrary(context, { limit: 2 }, deps);
    assert.deepEqual(
      page.items.map((x) => x.mediaId),
      ids.slice(3, 5),
    );
    assert.equal(page.hasMore, true);
    const next = await account.listReadingLibrary(
      context,
      { limit: 2, cursor: page.nextCursor },
      deps,
    );
    assert.deepEqual(
      next.items.map((x) => x.mediaId),
      ids.slice(5),
    );
    assert.deepEqual(
      (await account.listReadingLibrary({ ...context, userId: 'other' }, { limit: 2 }, deps)).items,
      [],
    );
    assert.equal((await f.db.all('SELECT * FROM library WHERE user_id=?', 'owner')).length, 7);
  } finally {
    f.close();
  }
});

test('account policy materialization agrees with shared eligibility, preserves independent title proof and rejects changed source identity', async () => {
  const { listReadingLibrary } = await import('../server/reading-account.js');
  const f = contextFixture();
  try {
    await f.db.run(
      "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('policy','Policy','policy@fixture','x','now')",
    );
    const source = accountSource(),
      store = createExternalCatalogStore(f.db);
    const title = await store.rememberTitle({
      sourceRef: source,
      upstreamRef: { sourceId: source.id, upstreamKey: '/policy', language: 'en' },
      classification: {
        ...source.classification,
        provenance: { ...source.classification.provenance, sourceField: 'title.contentRating' },
      },
      metadata: { title: 'Independent', category: 'MANGA' },
    });
    await f.db.run(
      "INSERT INTO library(user_id,media_id,updated_at) VALUES('policy',?,'now')",
      title.id,
    );
    const context = {
      userId: 'policy',
      destination: 'yoru',
      extensionsEnabled: true,
      overrides: {},
      selectionFingerprint: 'f',
      revision: 0,
    };
    const deps = {
      db: f.db,
      coreAccountMedia: async () => [],
      refreshSources: async () => ({
        currentSources: [accountSource('123', 'adult')],
        complete: false,
        sourceStates: [],
        nextCursor: 'inventory-next',
      }),
    };
    let result = await listReadingLibrary(context, { limit: 1 }, deps);
    assert.equal(result.items[0].mediaId, title.id);
    assert.equal(result.inventoryComplete, false);
    assert.match(result.sourceCursor, /^[a-f0-9]{32}$/);
    deps.refreshSources = async () => ({
      currentSources: [{ ...source, providerKey: 'Cubari' }],
      complete: true,
      sourceStates: [],
      nextCursor: null,
    });
    assert.deepEqual((await listReadingLibrary(context, { limit: 1 }, deps)).items, []);
    deps.refreshSources = async () => ({
      currentSources: [],
      complete: false,
      sourceStates: [{ state: 'unavailable' }],
      nextCursor: null,
    });
    assert.deepEqual((await listReadingLibrary(context, { limit: 1 }, deps)).items, []);
  } finally {
    f.close();
  }
});

test('guarded account writes reject preference revision drift atomically', async () => {
  const { accountAtomic } = await import('../server/reading-account.js');
  const f = contextFixture();
  try {
    await f.db.run(
      "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('revision','Revision','rev@fixture','x','now')",
    );
    await f.db.run("INSERT INTO reader_settings(user_id,revision) VALUES('revision',1)");
    await assert.rejects(
      accountAtomic(
        { userId: 'revision', revision: 0 },
        [
          {
            sql: "INSERT INTO library(user_id,media_id,updated_at) VALUES('revision','mal-manga-21','now')",
          },
        ],
        { db: f.db },
      ),
      { status: 409 },
    );
    assert.equal((await f.db.all("SELECT * FROM library WHERE user_id='revision'")).length, 0);
  } finally {
    f.close();
  }
});

test('logout during provider detail wait cannot commit native account progress', async () => {
  const { resolveAccountMedia } = await import('../server/reading-account.js');
  const { resolveReaderContext } = await import('../server/reader-context.js');
  const f = contextFixture();
  try {
    await f.db.run(
      "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('waiting','Waiting','wait@fixture','x','now')",
    );
    await f.db.run(
      "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES('waiting-session','waiting',?,'now')",
      Date.now() + 60000,
    );
    const source = accountSource(),
      title = {
        sourceRef: source,
        upstreamRef: { sourceId: source.id, upstreamKey: '/waiting', language: 'en' },
        classification: source.classification,
        metadata: { title: 'Wait', category: 'MANGA' },
      };
    const saved = await createExternalCatalogStore(f.db).rememberTitle(title);
    const context = await resolveReaderContext(
      { destination: 'yoru' },
      { db: f.db, userId: 'waiting', sessionHash: 'waiting-session', extensionsEnabled: true },
    );
    let release, entered;
    const ready = new Promise((done) => (entered = done));
    const pending = resolveAccountMedia(saved.id, null, context, {
      db: f.db,
      bridge: {
        details: async () => {
          entered();
          await new Promise((done) => (release = done));
          return title;
        },
      },
    });
    await ready;
    await f.db.run("DELETE FROM sessions WHERE token_hash='waiting-session'");
    release();
    await assert.rejects(pending, { status: 401 });
    assert.equal(
      (await f.db.all("SELECT * FROM resume_progress WHERE user_id='waiting'")).length,
      0,
    );
  } finally {
    f.close();
  }
});

test('private export retains hidden native records and never fabricates MAL IDs for unknown namespaces', async () => {
  const account = await import('../server/reading-account.js'),
    f = contextFixture();
  try {
    await f.db.run(account.readingAccountSchema);
    await f.db.run(
      "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('exporter','Exporter','export@fixture','x','now')",
    );
    const source = accountSource('123', 'adult'),
      store = createExternalCatalogStore(f.db);
    const media = await store.rememberTitle({
      sourceRef: source,
      upstreamRef: { sourceId: source.id, upstreamKey: '/private/export', language: 'en' },
      classification: source.classification,
      metadata: {
        title: 'Saved adult',
        category: 'MANGA',
        cover: 'https://private.trycloudflare.com/cover',
        localMangaId: '99',
      },
    });
    for (const id of [media.id, 'mal-manga-21', 'legacy-123'])
      await f.db.run(
        "INSERT INTO library(user_id,media_id,updated_at) VALUES('exporter',?,'now')",
        id,
      );
    const context = { userId: 'exporter', revision: 0, destination: 'ara-ara' };
    await account.accountAtomic(context, [account.accountSnapshotStatement(context, media)], {
      db: f.db,
    });
    const result = await account.exportReadingAccount(context, { db: f.db });
    assert.equal(result.items.length, 3);
    const native = result.items.find((item) => item.mediaId === media.id);
    assert.equal(native.destination, 'ara-ara');
    assert.equal(native.identity.malId, null);
    assert.equal(native.media.idMal, null);
    assert.equal(native.media.upstreamRef.upstreamKey, '/private/export');
    assert.equal(result.items.find((item) => item.mediaId === 'mal-manga-21').identity.malId, 21);
    assert.equal(result.items.find((item) => item.mediaId === 'legacy-123').identity.malId, null);
    assert.doesNotMatch(JSON.stringify(result), /trycloudflare|localMangaId/);
  } finally {
    f.close();
  }
});

test('bounded metadata batches still fill a page after more than five thousand ineligible rows', async () => {
  const { listReadingLibrary } = await import('../server/reading-account.js'),
    f = contextFixture();
  try {
    await f.db.run(
      "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('large','Large','large@fixture','x','now')",
    );
    const store = createExternalCatalogStore(f.db),
      adult = accountSource('100', 'adult'),
      safe = accountSource('200');
    await store.rememberSource(adult);
    await f.db.run(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<5001)
   INSERT INTO external_media(id,source_id,upstream_key,language,classification,metadata,created_at,updated_at)
   SELECT 'ext-manga-'||printf('%032x',i),?,'/adult/'||i,'en',?,'{"title":"Filtered adult","category":"MANGA"}','now','now' FROM n`,
      adult.id,
      JSON.stringify(adult.classification),
    );
    await f.db.run(
      "INSERT INTO library(user_id,media_id,updated_at) SELECT 'large',id,'2026-10-19' FROM external_media",
    );
    const media = await store.rememberTitle({
      sourceRef: safe,
      upstreamRef: { sourceId: safe.id, upstreamKey: '/safe/older', language: 'en' },
      classification: safe.classification,
      metadata: { title: 'Eligible older', category: 'MANGA' },
    });
    await f.db.run(
      "INSERT INTO library(user_id,media_id,updated_at) VALUES('large',?,'2026-10-18')",
      media.id,
    );
    let refreshes = 0;
    const result = await listReadingLibrary(
      {
        userId: 'large',
        destination: 'yoru',
        revision: 0,
        selectionFingerprint: 'large',
        extensionsEnabled: true,
        overrides: {},
      },
      { limit: 1 },
      {
        db: f.db,
        coreAccountMedia: async (ids) => {
          assert.ok(ids.length <= 5000);
          return [];
        },
        refreshSources: async () => {
          refreshes++;
          return {
            currentSources: [adult, safe],
            complete: true,
            sourceStates: [],
            nextCursor: null,
          };
        },
      },
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].mediaId, media.id);
    assert.equal(refreshes, 1);
  } finally {
    f.close();
  }
});

test('account scan budget returns an incomplete private keyset that resumes without losing older eligible records', async () => {
  const { listReadingLibrary } = await import('../server/reading-account.js'),
    f = contextFixture();
  try {
    await f.db.run(
      "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('budget','Budget','budget@fixture','x','now')",
    );
    const store = createExternalCatalogStore(f.db),
      adult = accountSource('100', 'adult'),
      safe = accountSource('200');
    await store.rememberSource(adult);
    await f.db.run(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<5001)
   INSERT INTO external_media(id,source_id,upstream_key,language,classification,metadata,created_at,updated_at)
   SELECT 'ext-manga-'||printf('%032x',i),?,'/adult/'||i,'en',?,'{"title":"Filtered","category":"MANGA"}','now','now' FROM n`,
      adult.id,
      JSON.stringify(adult.classification),
    );
    await f.db.run(
      "INSERT INTO library(user_id,media_id,updated_at) SELECT 'budget',id,'2026-10-19' FROM external_media",
    );
    const media = await store.rememberTitle({
      sourceRef: safe,
      upstreamRef: { sourceId: safe.id, upstreamKey: '/budget/older', language: 'en' },
      classification: safe.classification,
      metadata: { title: 'Older', category: 'MANGA' },
    });
    await f.db.run(
      "INSERT INTO library(user_id,media_id,updated_at) VALUES('budget',?,'2026-10-18')",
      media.id,
    );
    let clock = Date.now(),
      batches = 0;
    const deps = {
      db: f.db,
      now: () => clock,
      coreAccountMedia: async () => {
        if (batches++ === 0) clock += 12001;
        return [];
      },
      refreshSources: async () => ({
        currentSources: [adult, safe],
        complete: true,
        sourceStates: [],
        nextCursor: null,
      }),
    };
    const context = {
      userId: 'budget',
      destination: 'yoru',
      revision: 0,
      selectionFingerprint: 'budget',
      extensionsEnabled: true,
      overrides: {},
    };
    const first = await listReadingLibrary(context, { limit: 1 }, deps);
    assert.equal(first.items.length, 0);
    assert.equal(first.scanState, 'incomplete');
    assert.equal(first.recordsComplete, false);
    assert.match(first.nextCursor, /^[a-f0-9]{32}$/);
    const second = await listReadingLibrary(context, { limit: 1, cursor: first.nextCursor }, deps);
    assert.equal(second.items[0].mediaId, media.id);
    assert.equal(second.scanState, 'ready');
    assert.equal((await f.db.all("SELECT * FROM library WHERE user_id='budget'")).length, 5002);
  } finally {
    f.close();
  }
});

test('a concurrent source reclassification during inventory wait cannot admit its old source-derived safe title', async () => {
  const { listReadingLibrary } = await import('../server/reading-account.js'),
    f = contextFixture();
  try {
    await f.db.run(
      "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('race','Race','race@fixture','x','now')",
    );
    const store = createExternalCatalogStore(f.db),
      source = accountSource(),
      media = await store.rememberTitle({
        sourceRef: source,
        upstreamRef: { sourceId: source.id, upstreamKey: '/race', language: 'en' },
        classification: source.classification,
        metadata: { title: 'Old safe title', category: 'MANGA' },
      });
    await f.db.run(
      "INSERT INTO library(user_id,media_id,updated_at) VALUES('race',?,'now')",
      media.id,
    );
    const result = await listReadingLibrary(
      {
        userId: 'race',
        destination: 'yoru',
        extensionsEnabled: true,
        revision: 0,
        selectionFingerprint: 'race',
        overrides: {},
      },
      { limit: 1 },
      {
        db: f.db,
        coreAccountMedia: async () => [],
        refreshSources: async () => {
          await f.db.run(
            'UPDATE reader_sources SET classification=?,updated_at=? WHERE id=?',
            JSON.stringify(accountSource('123', 'adult').classification),
            new Date(Date.now() + 1).toISOString(),
            source.id,
          );
          return { currentSources: [source], complete: true, sourceStates: [], nextCursor: null };
        },
      },
    );
    assert.deepEqual(
      result.items,
      [],
      'newly observed adult proof must not be overwritten by an earlier inventory result',
    );
  } finally {
    f.close();
  }
});

test('native source eligibility changed immediately before the atomic account write rolls back the record', async () => {
  const { accountAtomic } = await import('../server/reading-account.js'),
    f = contextFixture();
  try {
    await f.db.run(
      "INSERT INTO users(id,name,email,password_hash,created_at) VALUES('write-race','Race','write-race@fixture','x','now')",
    );
    const source = accountSource(),
      store = createExternalCatalogStore(f.db),
      media = await store.rememberTitle({
        sourceRef: source,
        upstreamRef: { sourceId: source.id, upstreamKey: '/write-race', language: 'en' },
        classification: source.classification,
        metadata: { title: 'Save race', category: 'MANGA' },
      });
    const wrapped = {
      ...f.db,
      atomic: async (statements, guard) => {
        await f.db.run(
          'UPDATE reader_sources SET classification=? WHERE id=?',
          JSON.stringify(accountSource('123', 'adult').classification),
          source.id,
        );
        return f.db.atomic(statements, guard);
      },
    };
    await assert.rejects(
      accountAtomic(
        { userId: 'write-race', revision: 0, destination: 'yoru' },
        [
          {
            sql: "INSERT INTO library(user_id,media_id,updated_at) VALUES('write-race',?,'now')",
            values: [media.id],
          },
        ],
        { db: wrapped },
        { media },
      ),
      { status: 409 },
    );
    assert.equal((await f.db.all("SELECT * FROM library WHERE user_id='write-race'")).length, 0);
  } finally {
    f.close();
  }
});
