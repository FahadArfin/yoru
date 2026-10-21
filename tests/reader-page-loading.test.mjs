import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadReaderPage } from '../src/reader/page-loading.js';

const image = () =>
  new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
test('reader limits page fetches to four and cancels queued work', async () => {
  const original = globalThis.fetch;
  const pending = [];
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    return new Promise((resolve) => pending.push(() => resolve(image())));
  };
  try {
    const controllers = Array.from({ length: 9 }, () => new AbortController());
    const jobs = controllers.map((controller, index) =>
      loadReaderPage(`/page/${index}`, controller.signal),
    );
    const completed = Promise.allSettled(jobs);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 4);
    controllers[8].abort();
    pending.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 8);
    pending.splice(0).forEach((resolve) => resolve());
    const results = await completed;
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 8);
    assert.equal(results[8].status, 'rejected');
    assert.equal(calls, 8);
  } finally {
    globalThis.fetch = original;
  }
});
test('reader retries transient failures but never retries access denials', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => (++calls === 1 ? new Response('', { status: 503 }) : image());
    assert.equal((await loadReaderPage('/page/1', new AbortController().signal)).type, 'image/png');
    assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response('', { status: 403 });
    };
    await assert.rejects(loadReaderPage('/page/1', new AbortController().signal));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test('leaving the reader cancels a delayed retry', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response('', { status: 429, headers: { 'retry-after': '5' } });
    };
    const result = loadReaderPage('/page/1', controller.signal);
    const rejected = assert.rejects(result);
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    await rejected;
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
