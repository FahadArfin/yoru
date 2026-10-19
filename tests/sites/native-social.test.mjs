import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, Response } from 'miniflare';
import { runtimeOptions, migrate } from './harness.mjs';
import { socialHydrationRuntimeOptions } from './native-social-hydration.mjs';
import { sitesReaderDb, store } from '../../sites/store.js';
import {
  nativeSocialContract,
  socialProvider,
  socialSeeds,
  socialEventStream,
} from '../native-social-contract.mjs';

test('native social policy and exact chapter contracts across two D1 Workers', async () => {
  const provider = socialProvider();
  let instance = 0;
  const runtime = new Miniflare(
    socialHydrationRuntimeOptions(
      runtimeOptions({
        bindings: {
          READER_EXTENSIONS_ENABLED: '1',
          READER_BRIDGE_URL: 'https://native-social.trycloudflare.com',
          READER_BRIDGE_KEY: 'fixture-native-social-key-more-than-32-characters',
        },
        provider: async (request) => {
          const value = await provider.respond(
            new URL(request.url).pathname,
            await request.json().catch(() => ({})),
          );
          return value ? Response.json(value) : new Response('{}', { status: 404 });
        },
      }),
    ),
  );
  await runtime.ready;
  try {
    await migrate(runtime);
    const db = sitesReaderDb(store(await runtime.getD1Database('DB', 'a')));
    const request = async (path, { method = 'GET', body, session } = {}) => {
      const origin = `http://${instance++ % 2 ? 'b' : 'a'}.test`;
      const r = await runtime.dispatchFetch(origin + path, {
        method,
        headers: {
          origin,
          'content-type': 'application/json',
          ...(session ? { cookie: session.cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: await r.json(), headers: r.headers };
    };
    const register = async (name) => {
      const r = await request('/api/auth/register', {
        method: 'POST',
        body: { name, email: `${name}@fixture.test`, password: 'correct-horse-battery' },
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return { user: r.body.user, cookie: r.headers.get('set-cookie').split(';')[0] };
    };
    await nativeSocialContract({
      request,
      register,
      db,
      provider,
      ...socialSeeds(db, provider),
      events: async (path, session) =>
        socialEventStream(
          await runtime.dispatchFetch('http://a.test' + path, {
            headers: { cookie: session.cookie },
          }),
        ),
      poll: (roomId, session, destination) =>
        request(
          `/api/poll?connectionId=native-social-${destination}&roomId=${roomId}&destination=${destination}`,
          { session },
        ),
    });
  } finally {
    await runtime.dispose();
  }
});
