import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Response } from 'miniflare';
import { createRuntime, migrate } from './harness.mjs';
import { sitesReaderDb, store } from '../../sites/store.js';
import { createExternalCatalogStore } from '../../server/external-catalog-store.js';
import {
  extensionAccountContract,
  accountSource,
  accountProviderGate,
} from '../extension-account-contract.mjs';

test('native private account contract is identical across two D1 Workers', async () => {
  let inventory = [accountSource()],
    instance = 'a';
  const titles = new Map();
  let details = 0;
  const providerGate = accountProviderGate();
  const runtime = await createRuntime({
    bindings: {
      READER_EXTENSIONS_ENABLED: '1',
      READER_BRIDGE_URL: 'https://account-fixture.trycloudflare.com',
      READER_BRIDGE_KEY: 'fixture-account-key-more-than-32-characters',
    },
    provider: async (request) => {
      const path = new URL(request.url).pathname,
        data = await request.json();
      if (path === '/extension/catalogs') {
        const offset = Number(data.cursor || 0),
          limit = data.limit || 100;
        return Response.json({
          sources: inventory.slice(offset, offset + limit),
          nextCursor: offset + limit < inventory.length ? String(offset + limit) : null,
        });
      }
      if (path === '/extension/details') details++;
      await providerGate.wait(data.titleRef?.upstreamKey);
      const title = titles.get(data.titleRef?.upstreamKey);
      return title ? Response.json(title) : new Response('{}', { status: 404 });
    },
  });
  try {
    await migrate(runtime);
    const request = async (path, { method = 'GET', body, session } = {}) => {
      instance = instance === 'a' ? 'b' : 'a';
      const result = await runtime.dispatchFetch(`http://${instance}.test${path}`, {
        method,
        headers: {
          origin: `http://${instance}.test`,
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(session ? { cookie: session.cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: result.status, body: await result.json(), headers: result.headers };
    };
    const register = async (name) => {
      const response = await request('/api/auth/register', {
        method: 'POST',
        body: { name, email: `${name}@example.test`, password: 'correct-horse-battery' },
      });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return { user: response.body.user, cookie: response.headers.get('set-cookie').split(';')[0] };
    };
    const db = sitesReaderDb(store(await runtime.getD1Database('DB', 'a')));
    await extensionAccountContract({
      request,
      register,
      providerDetails: () => details,
      holdProvider: providerGate.holdProvider,
      releaseProvider: providerGate.releaseProvider,
      async inspectAccountRows(user, id) {
        return {
          library: (
            await db.get('SELECT COUNT(*) n FROM library WHERE user_id=? AND media_id=?', user, id)
          ).n,
          resume: (
            await db.get(
              'SELECT COUNT(*) n FROM resume_progress WHERE user_id=? AND media_id=?',
              user,
              id,
            )
          ).n,
        };
      },
      async seedEdition(media, key) {
        return createExternalCatalogStore(db).rememberEdition(media.id, {
          sourceRef: media.sourceRef,
          upstreamRef: { title: media.upstreamRef, upstreamKey: key },
          metadata: { number: '3', pages: 100 },
        });
      },
      async seedNative(sourceRef, key) {
        const title = {
          sourceRef,
          upstreamRef: { sourceId: sourceRef.id, upstreamKey: key, language: 'en' },
          classification: sourceRef.classification,
          metadata: { title: 'Native account title', category: 'MANGA' },
        };
        titles.set(key, title);
        return createExternalCatalogStore(db).rememberTitle(title);
      },
      async inspectStored(user, id) {
        return JSON.parse(
          (
            await db.get(
              'SELECT payload FROM resume_progress WHERE user_id=? AND media_id=?',
              user,
              id,
            )
          ).payload,
        );
      },
      async changeInventory(sources) {
        inventory = sources;
      },
    });
  } finally {
    await runtime.dispose();
  }
});
