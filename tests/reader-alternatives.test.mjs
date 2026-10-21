import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alternativeFixture, alternativeSource } from './reader-alternatives-fixture.mjs';
test('restrictive canonical candidate source proof predating the request wins over safe inventory', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL'),
      target = await f.native(f.targetSource, '/TARGET');
    await f.map(original, target);
    await f.db.run(
      'UPDATE reader_sources SET classification=?,updated_at=? WHERE id=?',
      JSON.stringify({ ...f.targetSource.classification, rating: 'adult' }),
      '2000-01-01T00:00:00.000Z',
      f.targetSource.id,
    );
    await assert.rejects(get({ id: original.id }, f.context, f.deps), { status: 404 });
    await f.db.run(
      'UPDATE external_media SET classification=? WHERE id=?',
      JSON.stringify({
        ...f.targetSource.classification,
        provenance: {
          ...f.targetSource.classification.provenance,
          sourceField: 'title.contentRating',
        },
      }),
      target.id,
    );
    const independent = await get({ id: original.id }, f.context, f.deps);
    assert.equal(independent.choices[0].mediaId, target.id);
  } finally {
    f.close();
  }
});
test('an inventory continuation that already emitted a choice can finish with an empty complete page', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL'),
      target = await f.native(f.targetSource, '/TARGET');
    await f.map(original, target);
    f.state.sources = [
      f.targetSource,
      ...Array.from({ length: 400 }, (_, i) =>
        alternativeSource(String(i + 10), 'Unknown provider'),
      ),
    ];
    const first = await get({ id: original.id }, f.context, f.deps);
    assert.equal(first.choices[0].mediaId, target.id);
    assert.equal(first.incomplete, true);
    const last = await get({ id: original.id, cursor: first.nextCursor }, f.context, f.deps);
    assert.deepEqual(last.choices, []);
    assert.equal(last.incomplete, false);
    assert.equal(last.nextCursor, null);
  } finally {
    f.close();
  }
});
test('a mapping continuation that already emitted choices can finish with an empty complete page', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL');
    for (let i = 0; i < 101; i++) {
      const core = await f.seedCore(`mal-manga-${10000 + i}`);
      await f.map(original, core);
      if (i === 100) core.isAdult = true;
    }
    const context = { ...f.context, integrationMode: 'core' };
    const first = await get({ id: original.id }, context, f.deps);
    assert.equal(first.choices.length, 100);
    assert.equal(first.incomplete, true);
    const last = await get({ id: original.id, cursor: first.nextCursor }, context, f.deps);
    assert.deepEqual(last.choices, []);
    assert.equal(last.incomplete, false);
    assert.equal(last.nextCursor, null);
  } finally {
    f.close();
  }
});
test('earlier unknown core proof cannot become silently complete on a later mapping window', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL');
    let missing;
    for (let i = 0; i < 101; i++) {
      const core = await f.seedCore(`mal-manga-${10000 + i}`);
      await f.map(original, core);
      if (i === 0) missing = core;
    }
    f.core.delete(missing.id);
    const context = { ...f.context, integrationMode: 'core' };
    const first = await get({ id: original.id }, context, f.deps);
    assert.equal(first.incomplete, true);
    assert.ok(first.nextCursor);
    const terminal = await get({ id: original.id, cursor: first.nextCursor }, context, f.deps);
    assert.equal(
      terminal.incomplete,
      true,
      'a later known window cannot erase earlier missing proof',
    );
    assert.ok(terminal.nextCursor);
    assert.equal(terminal.sourceStates[0].state, 'unverified');
    f.core.set(missing.id, missing);
    const retry = await get({ id: original.id, cursor: terminal.nextCursor }, context, f.deps);
    assert.ok(retry.choices.some((choice) => choice.mediaId === missing.id));
    assert.equal(retry.incomplete, true);
    const complete = await get({ id: original.id, cursor: retry.nextCursor }, context, f.deps);
    assert.equal(complete.incomplete, false);
  } finally {
    f.close();
  }
});
test('an explicit full proof retry resets the previous scan emitted flag', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL'),
      known = await f.seedCore('mal-manga-21'),
      missing = await f.seedCore('mal-manga-22');
    await f.map(original, known);
    await f.map(original, missing);
    f.core.delete(missing.id);
    const context = { ...f.context, integrationMode: 'core' };
    const first = await get({ id: original.id }, context, f.deps);
    assert.equal(first.choices.length, 1);
    assert.equal(first.incomplete, true);
    known.isAdult = true;
    f.core.set(missing.id, { ...missing, isAdult: true });
    await assert.rejects(get({ id: original.id, cursor: first.nextCursor }, context, f.deps), {
      status: 404,
    });
  } finally {
    f.close();
  }
});
test('fresh cached parent reclassification blocks core recovery without requesting the disabled original provider', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL'),
      core = await f.seedCore();
    await f.map(original, core);
    await f.db.run(
      'INSERT INTO reader_inventory_cache(source_id,payload,observed_at) VALUES(?,?,?)',
      f.originalSource.id,
      JSON.stringify({
        ...f.originalSource,
        classification: { ...f.originalSource.classification, rating: 'mixed' },
      }),
      Date.now(),
    );
    await assert.rejects(
      get({ id: original.id }, { ...f.context, integrationMode: 'core' }, f.deps),
      { status: 404 },
    );
    assert.equal(f.calls.filter((c) => c.operation === 'catalogs').length, 0);
  } finally {
    f.close();
  }
});
const get = async (...args) =>
  (await import('../server/reader-alternatives.js')).getReaderAlternatives(...args);
test('disabled native title exposes even one eligible exact alternative without original metadata or provider work', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL'),
      target = await f.native(f.targetSource, '/TARGET');
    await f.native(f.targetSource, '/SAME_NAME_UNMAPPED');
    await f.map(original, target);
    const result = await get({ id: original.id }, f.context, f.deps);
    assert.equal(result.choices.length, 1);
    assert.equal(result.choices[0].mediaId, target.id);
    assert.equal(result.choices[0].sourceRef.id, f.targetSource.id);
    assert.deepEqual(result.choices[0].upstreamRef, target.upstreamRef);
    assert.equal(result.incomplete, false);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|private.invalid|SAME_NAME/);
    assert.ok(!JSON.stringify(result).includes(original.id));
    assert.ok(f.calls.every((c) => ['catalogs', 'core-cache'].includes(c.operation)));
  } finally {
    f.close();
  }
});
test('core-only alternatives are cache-only unresolved exact owners and retain actual provider membership', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL'),
      core = await f.seedCore();
    await f.map(original, core);
    const result = await get(
      { id: original.id },
      { ...f.context, integrationMode: 'core' },
      f.deps,
    );
    assert.deepEqual(
      result.choices.map((c) => [c.mediaId, c.sourceRef.id, c.upstreamRef, c.state]),
      [[core.id, 'weebcentral', null, 'unresolved']],
    );
    assert.equal(f.calls.filter((c) => c.operation === 'catalogs').length, 0);
    assert.equal(f.calls.filter((c) => c.operation === 'core-cache').length, 1);
    await assert.rejects(
      get(
        { id: original.id },
        {
          ...f.context,
          integrationMode: 'core',
          overrides: { ...f.context.overrides, 'Weeb Central': { yoru: false } },
        },
        f.deps,
      ),
      { status: 404 },
    );
  } finally {
    f.close();
  }
});
test('absent wrong-destination unknown or gated parents remain unavailable without revealing source state', async () => {
  const f = alternativeFixture();
  try {
    const adult = await f.native(alternativeSource('3', 'MangaDex', 'adult'), '/SECRET_ADULT'),
      unknown = await f.native(alternativeSource('4', 'MangaDex', 'unknown'), '/UNKNOWN'),
      safe = await f.native(f.originalSource, '/SAFE');
    for (const [id, context] of [
      ['bad', f.context],
      [`ext-manga-${'f'.repeat(32)}`, f.context],
      [adult.id, f.context],
      [unknown.id, f.context],
      [safe.id, { ...f.context, extensionsEnabled: false }],
    ])
      await assert.rejects(
        get({ id }, context, f.deps),
        (e) => e.status === 404 && !e.sourceStates && !e.message.includes('SECRET'),
      );
    assert.equal(f.calls.filter((c) => c.operation === 'catalogs').length, 0);
  } finally {
    f.close();
  }
});
test('native alternatives use current inventory and never serialize a source reclassified during the wait', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL'),
      target = await f.native(f.targetSource, '/TARGET');
    await f.map(original, target);
    f.state.sources = [
      f.originalSource,
      { ...f.targetSource, classification: { ...f.targetSource.classification, rating: 'mixed' } },
    ];
    await assert.rejects(get({ id: original.id }, f.context, f.deps), { status: 404 });
    f.state.sources = [f.originalSource, f.targetSource];
    f.state.hook = () =>
      f.store.rememberSource({
        ...f.targetSource,
        classification: { ...f.targetSource.classification, rating: 'adult' },
      });
    await assert.rejects(get({ id: original.id }, f.context, f.deps), { status: 404 });
  } finally {
    f.close();
  }
});
test('bounded native source continuation advances beyond four inventory pages and binds owner destination selection and parent', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL'),
      lastSource = alternativeSource('999'),
      target = await f.native(lastSource, '/TARGET_LAST');
    await f.map(original, target);
    f.state.sources = [
      ...Array.from({ length: 405 }, (_, i) =>
        alternativeSource(String(i + 10), 'Unknown provider'),
      ),
      lastSource,
    ];
    const first = await get({ id: original.id }, f.context, f.deps);
    assert.deepEqual(first.choices, []);
    assert.equal(first.incomplete, true);
    assert.ok(first.nextCursor);
    assert.equal(f.calls.filter((c) => c.operation === 'catalogs').length, 4);
    for (const context of [
      { ...f.context, guestId: 'b'.repeat(64) },
      { ...f.context, destination: 'ara-ara' },
      { ...f.context, selectionFingerprint: 'changed' },
    ])
      await assert.rejects(get({ id: original.id, cursor: first.nextCursor }, context, f.deps), {
        status: 409,
      });
    const other = await f.native(f.originalSource, '/OTHER');
    await assert.rejects(get({ id: other.id, cursor: first.nextCursor }, f.context, f.deps), {
      status: 409,
    });
    const second = await get({ id: original.id, cursor: first.nextCursor }, f.context, f.deps);
    assert.equal(second.choices[0].mediaId, target.id);
    assert.equal(second.incomplete, false);
    assert.equal(f.calls.filter((c) => c.operation === 'catalogs').at(-1).cursor, '400');
  } finally {
    f.close();
  }
});
test('bounded mapping continuation advances past excluded native owners to an eligible later exact core alternative', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL');
    for (let i = 0; i < 100; i++)
      await f.map(original, await f.native(f.originalSource, `/EXCLUDED_${i}`));
    const core = await f.seedCore();
    await f.map(original, core);
    const context = { ...f.context, integrationMode: 'core' };
    const first = await get({ id: original.id }, context, f.deps);
    assert.deepEqual(first.choices, []);
    assert.equal(first.incomplete, true);
    assert.ok(first.nextCursor);
    const next = await get({ id: original.id, cursor: first.nextCursor }, context, f.deps);
    assert.equal(next.choices[0].mediaId, core.id);
    assert.equal(next.incomplete, false);
    assert.equal(f.calls.filter((c) => c.operation === 'catalogs').length, 0);
  } finally {
    f.close();
  }
});
test('failed source proof stays partial with an actionable retry and no stale alternative metadata', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL'),
      target = await f.native(f.targetSource, '/TARGET');
    await f.map(original, target);
    f.state.failure = true;
    const first = await get({ id: original.id }, f.context, f.deps);
    assert.deepEqual(first.choices, []);
    assert.equal(first.incomplete, true);
    assert.ok(first.nextCursor);
    assert.equal(first.sourceStates[0].reason, 'offline');
    assert.doesNotMatch(JSON.stringify(first), /SECRET|PRIVATE/);
    f.state.failure = false;
    const second = await get({ id: original.id, cursor: first.nextCursor }, f.context, f.deps);
    assert.equal(second.choices[0].mediaId, target.id);
  } finally {
    f.close();
  }
});
test('out-of-group core cache misses cannot create a misleading partial alternative response', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL'),
      core = await f.seedCore();
    await f.map(original, core);
    f.core.clear();
    await assert.rejects(
      get({ id: original.id }, { ...f.context, integrationMode: 'extensions' }, f.deps),
      { status: 404 },
    );
    assert.equal(f.calls.filter((c) => c.operation === 'core-cache').length, 0);
  } finally {
    f.close();
  }
});
test('missing eligible core proof remains an actionable cache-only retry without relabeling the selected native owner', async () => {
  const f = alternativeFixture();
  try {
    const original = await f.native(f.originalSource, '/SECRET_ORIGINAL'),
      core = await f.seedCore();
    await f.map(original, core);
    f.core.clear();
    const context = { ...f.context, integrationMode: 'core' },
      before = JSON.stringify(context);
    const first = await get({ id: original.id }, context, f.deps);
    assert.deepEqual(first.choices, []);
    assert.equal(first.incomplete, true);
    assert.ok(first.nextCursor);
    assert.equal(first.sourceStates[0].state, 'unverified');
    f.core.set(core.id, core);
    const next = await get({ id: original.id, cursor: first.nextCursor }, context, f.deps);
    assert.equal(next.choices[0].mediaId, core.id);
    assert.equal(next.choices[0].state, 'unresolved');
    assert.equal(JSON.stringify(context), before);
    assert.equal(f.calls.filter((c) => c.operation === 'catalogs').length, 0);
  } finally {
    f.close();
  }
});
