import test from 'node:test';
import assert from 'node:assert/strict';
import { recordView } from '../src/watch-views.js';

test('watch recording waits for the first cookie response before sending another view', async () => {
  const original = globalThis.fetch;
  let finish;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1)
      await new Promise((resolve) => {
        finish = resolve;
      });
    return Response.json({ ok: true });
  };
  try {
    const first = recordView('mal-anime-21');
    const second = recordView('mal-anime-21');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    finish();
    await Promise.all([first, second]);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
