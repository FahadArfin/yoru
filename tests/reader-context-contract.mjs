import assert from 'node:assert/strict';
import { test } from 'node:test';

export function readerContextContract(label, fixture) {
  test(`${label}: account sessions own unbounded snapshots and ignore guest or supplied account selectors`, async () => {
    const f = await fixture();
    try {
      const { resolveReaderContext, saveReaderContext } = await import(
        '../server/reader-context.js'
      );
      for (const id of ['one', 'two'])
        await f.db.run(
          'INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)',
          id,
          id,
          `${id}@test.invalid`,
          'unused',
          '2026-10-19',
        );
      await f.db.run(
        'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
        'one-session',
        'one',
        Date.now() + 60000,
        Date.now(),
      );
      const options = {
        db: f.db,
        userId: 'one',
        sessionHash: 'one-session',
        guestId: 'a'.repeat(64),
      };
      await f.db.atomic([
        ...Array.from({ length: 101 }, (_, i) => ({
          sql: 'INSERT INTO reader_catalog_preferences(user_id,provider,destination,enabled) VALUES(?,?,?,?)',
          values: ['one', `${i}${'漢'.repeat(95)}`, 'yoru', 0],
        })),
        { sql: 'INSERT INTO reader_settings(user_id,revision) VALUES(?,?)', values: ['one', 101] },
      ]);
      const resolved = await resolveReaderContext(
        { destination: 'yoru', userId: 'two', owner: 'two' },
        options,
      );
      assert.equal(resolved.userId, 'one');
      assert.equal(resolved.guestId, null);
      assert.equal(Object.keys(resolved.overrides).length, 101);
      assert.equal(resolved.revision, 101);
      assert.deepEqual(
        await saveReaderContext(
          { destination: 'yoru', userId: 'two', selection: 'INVALID' },
          options,
        ),
        resolved,
      );
      assert.equal(
        (
          await resolveReaderContext(
            { destination: 'yoru' },
            { ...options, userId: 'two', sessionHash: null },
          )
        ).revision,
        0,
      );
      await f.db.run('DELETE FROM sessions WHERE token_hash=?', 'one-session');
      await assert.rejects(resolveReaderContext({ destination: 'yoru' }, options), { status: 401 });
    } finally {
      await f.close();
    }
  });
  test(`${label}: context ownership and revision reject stale projections`, async () => {
    const f = await fixture();
    try {
      const { resolveReaderContext, saveReaderContext } = await import(
        '../server/reader-context.js'
      );
      const options = { db: f.db, guestId: 'a'.repeat(64), now: () => 1000 };
      const input = { destination: 'yoru' };
      const initial = await resolveReaderContext(input, options);
      assert.equal(initial.revision, 0);
      assert.equal(initial.integrationMode, 'all');
      const saved = await saveReaderContext(
        {
          ...input,
          expectedRevision: 0,
          selection: { overrides: { MangaDex: { yoru: false } }, modes: { yoru: 'extensions' } },
        },
        options,
      );
      assert.equal(saved.revision, 1);
      assert.notEqual(saved.selectionFingerprint, initial.selectionFingerprint);
      const competing = await Promise.allSettled(
        [1, 2].map(() =>
          saveReaderContext({ ...input, expectedRevision: 1, selection: {} }, options),
        ),
      );
      assert.equal(competing.filter((x) => x.status === 'fulfilled').length, 1);
      assert.equal(competing.find((x) => x.status === 'rejected').reason.status, 409);
      await assert.rejects(
        saveReaderContext({ ...input, expectedRevision: 0, selection: {} }, options),
        { status: 409 },
      );
      assert.equal(
        (await resolveReaderContext(input, { ...options, guestId: 'b'.repeat(64) })).revision,
        0,
      );
      assert.equal((await resolveReaderContext({ destination: 'ara-ara' }, options)).revision, 0);
      assert.equal(
        (await resolveReaderContext(input, { ...options, now: () => 1801001 })).revision,
        0,
      );
      const renewed = await saveReaderContext(
        { ...input, expectedRevision: 0, selection: {} },
        { ...options, now: () => 1801001 },
      );
      assert.equal(
        renewed.revision,
        3,
        'expired projection renewal cannot reuse an earlier accepted revision',
      );
      await assert.rejects(
        saveReaderContext(
          { ...input, expectedRevision: 1, selection: {} },
          { ...options, now: () => 1801001 },
        ),
        { status: 409 },
      );
      const rows = await f.db.all('SELECT * FROM reader_guest_contexts');
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0].guest_hash, options.guestId);
      await assert.rejects(
        saveReaderContext(
          {
            ...input,
            expectedRevision: 2,
            selection: {
              overrides: Object.fromEntries(
                Array.from({ length: 90 }, (_, i) => [`${i}${'漢'.repeat(95)}`, { yoru: true }]),
              ),
            },
          },
          options,
        ),
        { status: 400 },
      );
      await assert.rejects(
        saveReaderContext(
          {
            ...input,
            expectedRevision: 2,
            selection: {
              overrides: Object.fromEntries(
                Array.from({ length: 101 }, (_, i) => [`p${i}`, { yoru: true }]),
              ),
            },
          },
          options,
        ),
        { status: 400 },
      );
      // No supplied identity is consulted, even if it names a real different account.
      assert.equal(
        (await resolveReaderContext({ ...input, userId: 'another', owner: 'another' }, options))
          .userId,
        null,
      );
      await assert.rejects(resolveReaderContext({ destination: 'bad' }, options), { status: 400 });
    } finally {
      await f.close();
    }
  });
}
