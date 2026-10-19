import test from 'node:test';
import { Response } from 'miniflare';
import { createRuntime, migrate } from './harness.mjs';
import { sitesReaderDb, store } from '../../sites/store.js';
import { nativeToolProvider, nativeToolHttpContract } from '../webmcp-http-contract.mjs';

test('native tool HTTP contract uses identical policy across alternating D1 Workers', async () => {
  const provider = nativeToolProvider();
  const runtime = await createRuntime({
    bindings: {
      CATALOG_OFFLINE: '0',
      READER_EXTENSIONS_ENABLED: '1',
      READER_BRIDGE_URL: 'https://webmcp-fixture.trycloudflare.com',
      READER_BRIDGE_KEY: 'synthetic-webmcp-key-more-than-32-characters',
    },
    provider: async (request) => {
      const value = provider.respond(new URL(request.url).pathname, await request.json());
      return value ? Response.json(value) : new Response('{}', { status: 404 });
    },
  });
  try {
    await migrate(runtime);
    let instance = 0;
    const db = sitesReaderDb(store(await runtime.getD1Database('DB', 'a')));
    const request = async (path, { method = 'GET', body, session } = {}) => {
      const origin = `http://${instance++ % 2 ? 'b' : 'a'}.test`;
      const result = await runtime.dispatchFetch(origin + path, {
        method,
        headers: {
          origin,
          'content-type': 'application/json',
          ...(session ? { cookie: session.cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: result.status, body: await result.json(), headers: result.headers };
    };
    await nativeToolHttpContract({ request, db, provider });
  } finally {
    await runtime.dispose();
  }
});
