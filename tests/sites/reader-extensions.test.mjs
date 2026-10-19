import { Response } from 'miniflare';
import { extensionCatalogContract, catalogProvider } from '../extension-catalog-contract.mjs';
import { createRuntime, migrate, sql } from './harness.mjs';
extensionCatalogContract('Shared D1 alternating Workers', async () => {
  const provider = catalogProvider();
  const runtime = await createRuntime({
    bindings: {
      CATALOG_OFFLINE: '0',
      READER_EXTENSIONS_ENABLED: '1',
      READER_BRIDGE_KEY: 'fixture-bridge-key-more-than-32-characters',
      READER_BRIDGE_URL: 'https://fixture.trycloudflare.com',
    },
    provider: (request) => provider.respond(request, Response),
  });
  await migrate(runtime);
  let n = 0,
    defaultCookie = '';
  const request = async (path, { method = 'GET', body, cookie = defaultCookie } = {}) => {
    const origin = `http://${n++ % 2 ? 'b' : 'a'}.test`;
    const response = await runtime.dispatchFetch(origin + path, {
      method,
      headers: { origin, cookie, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!defaultCookie && response.headers.get('set-cookie'))
      defaultCookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  return {
    provider,
    request,
    async guest(selection) {
      const response = await request('/api/reader/context', { cookie: '' });
      const cookie = response.headers.get('set-cookie').split(';')[0];
      await request('/api/reader/context', {
        method: 'POST',
        cookie,
        body: { destination: 'yoru', expectedRevision: 0, selection },
      });
      return cookie;
    },
    async account() {
      const { createHash } = await import('node:crypto');
      await sql(runtime, [
        [
          'INSERT INTO users(id,name,email,created_at) VALUES(?,?,?,?)',
          'catalog-account',
          'Catalog',
          'catalog@test.invalid',
          '2026-10-19',
        ],
        [
          'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
          createHash('sha256').update('catalog-session').digest('hex'),
          'catalog-account',
          Date.now() + 60000,
          '2026-10-19',
        ],
        [
          'INSERT INTO reader_catalog_preferences(user_id,provider,destination,enabled) VALUES(?,?,?,?)',
          'catalog-account',
          'MangaDex',
          'yoru',
          0,
        ],
      ]);
      return 'yoru_session=catalog-session';
    },
    close: () => runtime.dispose(),
  };
});
