import { test } from 'node:test';
import { Miniflare, Response } from 'miniflare';
import { runtimeOptions, migrate } from './harness.mjs';
import { sitesReaderDb, store } from '../../sites/store.js';
import {
  disabledRollbackContract,
  rollbackProvider,
} from '../reader-disabled-rollback-contract.mjs';

test('compatible disabled D1 Worker hides retained Ara records while core continues on shared DB', async () => {
  const provider = rollbackProvider();
  const options = runtimeOptions({
    bindings: {
      CATALOG_OFFLINE: '0',
      READER_EXTENSIONS_ENABLED: '1',
      READER_BRIDGE_URL: 'https://rollback-fixture.trycloudflare.com',
      READER_BRIDGE_KEY: 'fixture-rollback-key-more-than-32-characters',
    },
    provider: async (request) => {
      const result = await provider.respond(
        new URL(request.url).pathname,
        await request.json().catch(() => ({})),
      );
      return result?.bytes
        ? new Response(result.bytes, {
            headers: { 'content-type': result.type, 'x-yoru-cache': 'hit' },
          })
        : Response.json(result?.json || {}, { status: result ? 200 : 404 });
    },
  });
  // Change only the test entry's runtime binding. Application artifact bytes are unchanged.
  for (const worker of options.workers) {
    const entry = Object.entries(worker.config.manifest.modules).find(([path]) =>
      path.endsWith('/entry.mjs'),
    )?.[1];
    const marker = 'return app.fetch(request,env,ctx);';
    if (!entry.contents.includes(marker)) throw new Error('Rollback fixture seam moved');
    entry.contents = entry.contents.replace(
      marker,
      "return app.fetch(request,{...env,READER_EXTENSIONS_ENABLED:env.INSTANCE==='b'?'0':'1'},ctx);",
    );
  }
  const runtime = new Miniflare(options);
  await runtime.ready;
  let instance = 'a';
  try {
    await migrate(runtime);
    const db = sitesReaderDb(store(await runtime.getD1Database('DB', 'a')));
    const request = async (path, { method = 'GET', body, session } = {}) => {
      const origin = `http://${instance}.test`;
      const result = await runtime.dispatchFetch(origin + path, {
        method,
        headers: {
          origin,
          'content-type': 'application/json',
          ...(session ? { cookie: session.cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const bytes = await result.arrayBuffer();
      return {
        status: result.status,
        headers: result.headers,
        body: result.headers.get('content-type')?.includes('application/json')
          ? JSON.parse(Buffer.from(bytes).toString())
          : { bytes: bytes.byteLength },
      };
    };
    await disabledRollbackContract({
      request,
      db,
      provider,
      disable: async () => {
        instance = 'b';
      },
    });
  } finally {
    await runtime.dispose();
  }
});
