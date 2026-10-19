import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test('core and generic calls share the bounded queue', async () => {
  const { createSuwayomiClient } = await import('../services/reader-bridge/suwayomi-client.mjs');
  const { Providers } = await import('../services/reader-bridge/providers.mjs');
  let active = 0,
    maximum = 0,
    calls = 0;
  const first = deferred();
  const client = createSuwayomiClient({
    url: 'http://fixture',
    fetchImpl: async () => {
      calls++;
      maximum = Math.max(maximum, ++active);
      if (calls === 1) await first.promise;
      active--;
      return Response.json({ data: { sources: { nodes: [] } } });
    },
  });
  const directory = await mkdtemp(join(tmpdir(), 'yoru-queue-'));
  try {
    const core = new Providers({ directory, client });
    const work = [core.gql('CoreSearch', { input: {} })];
    await new Promise((r) => setImmediate(r));
    const abort = new AbortController();
    const cancelled = client.execute('sources', {}, { signal: abort.signal });
    const rejected = assert.rejects(cancelled, { name: 'AbortError' });
    abort.abort();
    for (let i = 0; i < 32; i++) work.push(client.execute('sources'));
    assert.equal(client.queue.snapshot().pending, 32);
    await assert.rejects(client.execute('sources'), (e) => e.status === 429);
    first.resolve();
    await Promise.all([...work, rejected]);
    assert.equal(maximum, 1);
    assert.equal(calls, 33);
    await client.execute('sources');
    assert.equal(client.queue.snapshot().active, 0);
  } finally {
    first.resolve();
    await rm(directory, { recursive: true, force: true });
  }
});

test('queue recovers after task rejection and expires queued deadlines without dispatch', async () => {
  const { OperationQueue } = await import('../services/reader-bridge/suwayomi-client.mjs');
  const queue = new OperationQueue();
  const gate = deferred();
  const first = queue.run(() => gate.promise);
  let called = false;
  await assert.rejects(
    queue.run(
      () => {
        called = true;
      },
      { deadlineAt: Date.now() + 10 },
    ),
    { name: 'TimeoutError' },
  );
  assert.equal(called, false);
  gate.resolve();
  await first;
  await assert.rejects(
    queue.run(() => {
      throw new Error('fixture');
    }),
    /fixture/,
  );
  assert.equal(await queue.run(() => 7), 7);
});

test('transport preserves upstream status and Retry-After without leaking response bodies', async () => {
  const { createSuwayomiClient } = await import('../services/reader-bridge/suwayomi-client.mjs');
  for (const status of [401, 403, 429]) {
    const client = createSuwayomiClient({
      url: 'http://fixture',
      now: () => 1000,
      fetchImpl: async () =>
        new Response('private-secret', { status, headers: { 'retry-after': '12' } }),
    });
    await assert.rejects(
      client.execute('sources'),
      (e) =>
        e.status === status &&
        e.retryAfter === '12' &&
        e.retryAt === new Date(13000).toISOString() &&
        !e.message.includes('private-secret'),
    );
  }
});

test('fixed transport rejects arbitrary operations, external images and oversized images', async () => {
  const { createSuwayomiClient } = await import('../services/reader-bridge/suwayomi-client.mjs');
  let calls = 0;
  const client = createSuwayomiClient({
    url: 'http://fixture',
    limits: { imageBytes: 2 },
    fetchImpl: async () => {
      calls++;
      return new Response('abc', { headers: { 'content-type': 'image/png' } });
    },
  });
  await assert.rejects(client.execute('query { settings { password } }'));
  await assert.rejects(client.fetchImage('https://evil.invalid/image'));
  assert.equal(calls, 0);
  await assert.rejects(client.fetchImage('/api/v1/image'), /large/);
});

test('fixed operation selections match the saved installed schema without live introspection', async () => {
  const { operations } = await import('../services/reader-bridge/suwayomi-operations.mjs');
  const schema = JSON.parse(
    await readFile(new URL('./fixtures/suwayomi-schema.json', import.meta.url)),
  );
  const types = new Map([...schema.roots, ...schema.types].map((type) => [type.name, type]));
  const baseType = (type) => (type.ofType ? baseType(type.ofType) : type.name);
  for (const [operation, document] of Object.entries(operations)) {
    // The probe intentionally omitted indexed MangaNodeList; this existing
    // custom-server path is covered separately by reader-connection tests.
    if (operation === 'indexedCatalog') continue;
    const tokens = document.match(/[A-Za-z_][\w]*|[^\s,]/g);
    let at = 0;
    const skipArguments = () => {
      if (tokens[at] !== '(') return;
      let depth = 0;
      do {
        const token = tokens[at++];
        if (token === '(') depth++;
        if (token === ')') depth--;
      } while (depth && at < tokens.length);
    };
    const selection = (typeName) => {
      assert.equal(tokens[at++], '{', operation);
      while (tokens[at] !== '}') {
        const fieldName = tokens[at++];
        const field = types.get(typeName)?.fields?.find((field) => field.name === fieldName);
        assert.ok(field, `${operation}: ${typeName}.${fieldName} was not probed`);
        skipArguments();
        if (tokens[at] === '{') selection(baseType(field.type));
      }
      at++;
    };
    const root = tokens[at++] === 'mutation' ? 'Mutation' : 'Query';
    at++;
    skipArguments();
    selection(root);
    assert.equal(at, tokens.length, operation);
  }
});
