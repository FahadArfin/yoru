import express from 'express';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extensionCatalogContract, catalogProvider } from './extension-catalog-contract.mjs';
import { nodeReaderDb } from '../server/reader-db.js';
extensionCatalogContract('Node disposable SQLite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yoru-catalog-http-'));
  process.env.DATA_DIR = directory;
  process.env.YORU_DB_PATH = ':memory:';
  process.env.CATALOG_OFFLINE = '0';
  process.env.READER_EXTENSIONS_ENABLED = '1';
  process.env.READER_BRIDGE_KEY = 'fixture-bridge-key-more-than-32-characters';
  process.env.READER_BRIDGE_URL = 'https://fixture.trycloudflare.com';
  const provider = catalogProvider(),
    originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) =>
    String(url).startsWith(process.env.READER_BRIDGE_URL)
      ? provider.respond(new Request(url, options))
      : originalFetch(url, options);
  const { catalogRouter } = await import('../server/catalog.js');
  const { originGuard, sessionMiddleware } = await import('../server/auth.js');
  const { readerErrorMiddleware } = await import('../server/reader-errors.js');
  const { db } = await import('../server/db.js');
  const app = express();
  app.use(express.json());
  app.use('/api', originGuard, sessionMiddleware, catalogRouter);
  app.use(readerErrorMiddleware);
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: error.expose ? error.message : 'Unavailable' }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let defaultCookie = '';
  const request = async (path, { method = 'GET', body, cookie = defaultCookie } = {}) => {
    const response = await originalFetch(origin + path, {
      method,
      headers: { origin, cookie, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!defaultCookie && response.headers.get('set-cookie'))
      defaultCookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  return {
    readerDb: nodeReaderDb(await import('../server/db.js')),
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
      db.prepare('INSERT INTO users(id,name,email,created_at) VALUES(?,?,?,?)').run(
        'catalog-account',
        'Catalog',
        'catalog@test.invalid',
        '2026-10-19',
      );
      db.prepare(
        'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
      ).run(
        (await import('../server/auth.js')).hashToken('catalog-session'),
        'catalog-account',
        Date.now() + 60000,
        '2026-10-19',
      );
      db.prepare(
        'INSERT INTO reader_catalog_preferences(user_id,provider,destination,enabled) VALUES(?,?,?,?)',
      ).run('catalog-account', 'MangaDex', 'yoru', 0);
      return 'yoru_session=catalog-session';
    },
    async expireBridge() {
      delete process.env.READER_BRIDGE_URL;
      await writeFile(
        join(directory, 'reader-bridge-v1-endpoint.json'),
        JSON.stringify({ url: 'https://fixture.trycloudflare.com', expiresAt: Date.now() - 1 }),
      );
    },
    async close() {
      globalThis.fetch = originalFetch;
      await new Promise((r) => server.close(r));
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
});
