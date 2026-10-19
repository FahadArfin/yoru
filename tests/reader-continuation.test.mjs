import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextFixture } from './reader-context-fixture.mjs';

test('continuation enforces expiry size and selection ownership', async () => {
  const { createContinuationStore, continuationSchema } = await import(
    '../server/reader-continuation.js'
  );
  const f = contextFixture();
  let time = 1000;
  const context = { userId: 'one', destination: 'yoru', selectionFingerprint: 'selection' };
  try {
    // The production migration must already install the same table.
    assert.ok(continuationSchema.includes('reader_continuations'));
    const store = createContinuationStore(f.db, { now: () => time });
    const cursor = await store.start(context, { position: 2 });
    assert.ok(Buffer.byteLength(cursor) <= 2048);
    assert.deepEqual(await store.resume(cursor, context), { position: 2 });
    const row = await f.db.get('SELECT * FROM reader_continuations');
    assert.equal(row.expires_at - time, 1800000);
    for (const changed of [
      { userId: 'two' },
      { destination: 'ara-ara' },
      { selectionFingerprint: 'other' },
    ])
      await assert.rejects(store.resume(cursor, { ...context, ...changed }), {
        status: 409,
        restartRequired: true,
      });
    await assert.rejects(store.resume('a'.repeat(2049), context), {
      status: 409,
      restartRequired: true,
    });
    await assert.rejects(store.start(context, { large: '漢'.repeat(400000) }), { status: 413 });
    const next = await store.advance(cursor, { position: 3 });
    assert.equal(
      (await f.db.all('SELECT * FROM reader_continuations')).length,
      1,
      'a continuation session retains one bounded state',
    );
    await assert.rejects(store.resume(cursor, context), { status: 409, restartRequired: true });
    time += 1799999;
    assert.deepEqual(await store.resume(next, context), { position: 3 });
    time++;
    await assert.rejects(store.resume(next, context), { status: 409, restartRequired: true });
    await store.prune();
    assert.equal((await f.db.all('SELECT * FROM reader_continuations')).length, 0);
  } finally {
    f.close();
  }
});
