import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createRuntime, migrate, sql } from './harness.mjs';

test('catalog overrides sync across Workers, isolate accounts, reject stale sessions and reset to defaults', async () => {
  const runtime = await createRuntime();
  try {
    await migrate(runtime);
    for (const id of ['one', 'two']) {
      await sql(runtime, [
        [
          'INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)',
          id,
          id,
          `${id}@example.test`,
          'unused',
          new Date().toISOString(),
        ],
        [
          'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
          createHash('sha256').update(id).digest('hex'),
          id,
          Date.now() + 60000,
          Date.now(),
        ],
      ]);
    }
    const request = (instance, owner, method = 'GET', body) =>
      runtime.dispatchFetch(`http://${instance}.test/api/reader/preferences`, {
        method,
        headers: {
          origin: `http://${instance}.test`,
          'content-type': 'application/json',
          ...(owner ? { cookie: `yoru_session=${owner}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const defaults = await (await request('a', '')).json();
    assert.equal(defaults.defaults.NineHentai.yoru, false);
    assert.equal(defaults.defaults.NineHentai['ara-ara'], true);
    assert.equal((await request('a', '', 'PATCH', {})).status, 401);
    const body = { owner: 'one', provider: 'MangaDex', destination: 'yoru', enabled: false };
    assert.equal((await request('a', 'one', 'PATCH', body)).status, 200);
    assert.deepEqual((await (await request('b', 'one')).json()).overrides, {
      MangaDex: { yoru: false },
    });
    assert.deepEqual((await (await request('b', 'two')).json()).overrides, {});
    assert.equal((await request('b', 'two', 'PATCH', body)).status, 409);
    assert.equal((await request('b', 'one', 'DELETE', { owner: 'one' })).status, 200);
    assert.deepEqual((await (await request('a', 'one')).json()).overrides, {});
    await sql(runtime, [['DELETE FROM sessions WHERE user_id=?', 'one']]);
    assert.equal((await request('b', 'one', 'PATCH', body)).status, 401);
  } finally {
    await runtime.dispose();
  }
});
