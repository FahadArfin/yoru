import assert from 'node:assert/strict';
import { test } from 'node:test';

export const classification = {
  rating: 'unknown',
  provenance: { sourceField: null, value: null, checkedAt: '2026-10-18T00:00:00Z' },
};
export function source(id = 'suwayomi:123') {
  return {
    id,
    integration: 'suwayomi',
    upstreamSourceId: id.slice(9),
    providerKey: 'Fixture Reader',
    language: 'en',
    classification,
    capabilities: Object.fromEntries(
      ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map((key) => [
        key,
        'unverified',
      ]),
    ),
    bridgeInstance: 'bridge-first',
  };
}
export function title(key = '/manga/one', sourceRef = source()) {
  return {
    sourceRef,
    upstreamRef: { sourceId: sourceRef.id, upstreamKey: key, language: sourceRef.language },
    localMangaId: '7',
    classification,
    metadata: { title: 'Same name', category: 'MANGA', score: null, year: null },
  };
}
export function edition(bridgeTitle = title(), key = '/chapter/special') {
  return {
    sourceRef: bridgeTitle.sourceRef,
    upstreamRef: { title: bridgeTitle.upstreamRef, upstreamKey: key },
    localMangaId: '7',
    localChapterId: '11',
    metadata: { title: 'Special', number: null, volume: null, language: 'en', order: 0, pages: 8 },
  };
}

// Both backends exercise the same public store, with independent connections on reopen.
export function identityContract(name, fixture) {
  test(`${name}: canonical references survive reopen and verified rebind`, async () => {
    const f = await fixture();
    try {
      const a = f.open();
      const original = await a.rememberTitle(title());
      assert.match(original.id, /^ext-manga-[0-9a-f]{32}$/);
      const chapter = await a.rememberEdition(original.id, edition());
      assert.match(chapter.id, /^ext-chapter-[0-9a-f]{32}$/);
      assert.equal(chapter.pages, 8);
      assert.equal(chapter.pageCount, 8);
      assert.equal(chapter.number, null);
      await a.bindLocal(original.id, {
        bridgeInstance: 'bridge-first',
        localId: '7',
        verifiedAt: '2026-10-18T00:00:00Z',
      });
      const b = await f.reopen();
      const restored = title();
      restored.sourceRef.bridgeInstance = 'bridge-restored';
      restored.localMangaId = '99';
      const reopened = await b.rememberTitle(restored);
      assert.equal(reopened.id, original.id);
      await b.bindLocal(original.id, {
        bridgeInstance: 'bridge-restored',
        localId: '99',
        verifiedAt: '2026-10-18T01:00:00Z',
      });
      assert.equal((await b.getTitle(original.id)).upstreamRef.upstreamKey, '/manga/one');
      assert.equal((await b.rememberEdition(original.id, edition(restored))).id, chapter.id);
      assert.equal((await b.getEdition(chapter.id)).mediaId, original.id);
      assert.equal('localMangaId' in reopened, false);
      assert.equal('localChapterId' in chapter, false);
      const otherSource = await b.rememberTitle(title('/manga/one', source('suwayomi:456')));
      assert.notEqual(otherSource.id, original.id);
      const otherLanguage = title();
      otherLanguage.upstreamRef.language = 'ja';
      assert.notEqual((await b.rememberTitle(otherLanguage)).id, original.id);
      assert.equal(await b.getTitle('ext-manga-' + 'f'.repeat(32)), null);
      assert.equal(await b.getEdition('ext-chapter-' + 'f'.repeat(32)), null);
    } finally {
      await f.close();
    }
  });

  test(`${name}: reused local integers cannot change public ownership`, async () => {
    const f = await fixture();
    try {
      const a = f.open();
      const first = await a.rememberTitle(title());
      const secondTitle = title('/manga/two');
      const second = await a.rememberTitle(secondTitle);
      const firstChapter = await a.rememberEdition(first.id, edition());
      await assert.rejects(
        a.rememberEdition(second.id, edition()),
        /ownership|canonical|identity/i,
      );
      await a.bindLocal(first.id, {
        bridgeInstance: 'bridge-first',
        localId: '7',
        verifiedAt: '2026-10-18T00:00:00Z',
      });
      await assert.rejects(
        a.bindLocal(second.id, {
          bridgeInstance: 'bridge-first',
          localId: '7',
          verifiedAt: '2026-10-18T00:00:00Z',
        }),
        /ownership|canonical|identity|unique/i,
      );
      const b = await f.reopen();
      await b.bindLocal(second.id, {
        bridgeInstance: 'bridge-restored',
        localId: '7',
        verifiedAt: '2026-10-18T01:00:00Z',
      });
      assert.equal((await b.getTitle(first.id)).upstreamRef.upstreamKey, '/manga/one');
      assert.equal((await b.getTitle(second.id)).upstreamRef.upstreamKey, '/manga/two');
      assert.equal((await b.getEdition(firstChapter.id)).mediaId, first.id);
      const wrongSource = source();
      wrongSource.providerKey = 'Different provider';
      await assert.rejects(b.rememberSource(wrongSource), /ownership|canonical|identity/i);
      const spoof = title();
      spoof.upstreamRef.sourceId = 'suwayomi:456';
      await assert.rejects(b.rememberTitle(spoof), /ownership|canonical|identity/i);
      await assert.rejects(
        b.bindLocal(first.id, {
          bridgeInstance: 'bridge-restored',
          localId: '8',
          verifiedAt: null,
        }),
        /verified|invalid/i,
      );
    } finally {
      await f.close();
    }
  });

  test(`${name}: exact equivalence preserves distinct IDs and metadata identity`, async () => {
    const f = await fixture();
    try {
      const a = f.open();
      const input = title();
      input.metadata = { ...input.metadata, id: 'mal-manga-1', sourceRef: source('suwayomi:999') };
      const first = await a.rememberTitle(input);
      const second = await a.rememberTitle(title('/manga/two'));
      assert.match(first.id, /^ext-manga-/);
      assert.equal(first.sourceRef.id, 'suwayomi:123');
      assert.equal(first.classification.rating, 'unknown');
      assert.equal(first.score, null);
      assert.equal(first.year, null);
      await assert.rejects(a.addEquivalence(first.id, second.id, {}), /evidence|invalid/i);
      const evidence = { kind: 'trusted-mapping', reference: 'fixture-reviewed-map:1' };
      await a.addEquivalence(first.id, second.id, evidence);
      const b = await f.reopen();
      assert.deepEqual(
        (await b.getEquivalences(second.id)).map((x) => x.evidence),
        [evidence],
      );
      assert.equal((await b.getTitle(first.id)).id, first.id);
      assert.equal((await b.getTitle(second.id)).id, second.id);
    } finally {
      await f.close();
    }
  });

  test(`${name}: atomic writes roll back on revoked sessions and statement failure`, async () => {
    const f = await fixture();
    try {
      const db = f.db();
      await db.run('CREATE TABLE identity_atomic_test(value TEXT PRIMARY KEY)');
      await db.run("INSERT INTO users(id,name,created_at) VALUES('reader','Reader','now')");
      await db.run(
        'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
        'reader-token',
        'reader',
        Date.now() + 60000,
        Date.now(),
      );
      const guard = { userId: 'reader', sessionHash: 'reader-token' };
      await db.atomic(
        [{ sql: 'INSERT INTO identity_atomic_test VALUES(?)', values: ['kept'] }],
        guard,
      );
      await assert.rejects(
        db.atomic(
          [
            { sql: 'INSERT INTO identity_atomic_test VALUES(?)', values: ['rolled-back'] },
            { sql: 'INSERT INTO identity_atomic_test VALUES(?)', values: ['kept'] },
          ],
          guard,
        ),
      );
      assert.equal(
        await db.get('SELECT * FROM identity_atomic_test WHERE value=?', 'rolled-back'),
        null,
      );
      await db.run('DELETE FROM sessions WHERE token_hash=?', 'reader-token');
      await assert.rejects(
        db.atomic(
          [{ sql: 'INSERT INTO identity_atomic_test VALUES(?)', values: ['revoked'] }],
          guard,
        ),
        (error) => error.status === 401,
      );
      assert.equal(
        await db.get('SELECT * FROM identity_atomic_test WHERE value=?', 'revoked'),
        null,
      );
    } finally {
      await f.close();
    }
  });

  test(`${name}: sparse metadata leaves unsupported ratings and dates null`, async () => {
    const f = await fixture();
    try {
      const input = title();
      input.metadata = { title: 'Sparse provider title' };
      const record = await f.open().rememberTitle(input);
      for (const key of [
        'score',
        'averageScore',
        'rating',
        'year',
        'startDate',
        'endDate',
        'popularity',
        'rank',
      ]) {
        assert.equal(record[key], null, key);
      }
      assert.equal(record.category, 'MANGA');
      assert.equal(record.classification.rating, 'unknown');
    } finally {
      await f.close();
    }
  });

  test(`${name}: provider metadata cannot turn a native title into an anime or MAL identity`, async () => {
    const f = await fixture();
    try {
      const input = title();
      input.metadata = {
        title: 'Native title',
        type: 'ANIME',
        category: 'ANIME',
        malId: 1,
        idMal: 1,
      };
      const record = await f.open().rememberTitle(input);
      assert.equal(record.type, 'MANGA');
      assert.equal(record.category, 'MANGA');
      assert.equal(record.malId, null);
      assert.equal(record.idMal, null);
      assert.match(record.id, /^ext-manga-/);
    } finally {
      await f.close();
    }
  });

  test(`${name}: binding constraints reject missing permanent owners`, async () => {
    const f = await fixture();
    try {
      const media = await f.open().rememberTitle(title());
      await assert.rejects(
        f.db().run(
          `INSERT INTO reader_local_bindings(reference_id,source_id,media_id,edition_id,kind,bridge_instance,local_id,verified_at)
          VALUES(?,?,NULL,NULL,'media','bridge-first','7','2026-10-18T00:00:00Z')`,
          media.id,
          media.sourceRef.id,
        ),
        /CHECK constraint/i,
      );
    } finally {
      await f.close();
    }
  });
}
