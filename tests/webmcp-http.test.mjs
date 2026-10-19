import test from 'node:test';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nativeToolProvider, nativeToolHttpContract } from './webmcp-http-contract.mjs';

test('native tool HTTP contract uses real Node session and destination policy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yoru-webmcp-http-'));
  const provider = nativeToolProvider(),
    originalFetch = globalThis.fetch;
  const names = [
    'DATA_DIR',
    'YORU_DB_PATH',
    'CATALOG_OFFLINE',
    'READER_EXTENSIONS_ENABLED',
    'READER_BRIDGE_KEY',
    'READER_BRIDGE_URL',
  ];
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    DATA_DIR: directory,
    YORU_DB_PATH: ':memory:',
    CATALOG_OFFLINE: '0',
    READER_EXTENSIONS_ENABLED: '1',
    READER_BRIDGE_KEY: 'synthetic-webmcp-key-more-than-32-characters',
    READER_BRIDGE_URL: 'https://webmcp-fixture.trycloudflare.com',
  });
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith(process.env.READER_BRIDGE_URL))
      throw new Error('Unexpected external request in native tools fixture.');
    const value = provider.respond(new URL(url).pathname, JSON.parse(options.body));
    return value ? Response.json(value) : Response.json({}, { status: 404 });
  };
  let server, rawDb;
  try {
    const { catalogRouter } = await import('../server/catalog.js');
    const { socialRouter } = await import('../server/social.js');
    const { authRouter, originGuard, sessionMiddleware } = await import('../server/auth.js');
    const { readerErrorMiddleware } = await import('../server/reader-errors.js');
    const { nodeReaderDb } = await import('../server/reader-db.js');
    const database = await import('../server/db.js');
    rawDb = database.db;
    const db = nodeReaderDb(database);
    const app = express();
    app.use(express.json());
    app.use('/api', originGuard, sessionMiddleware);
    app.use('/api/auth', authRouter);
    app.use('/api', catalogRouter, socialRouter);
    app.use(readerErrorMiddleware);
    app.use((error, _req, res, _next) =>
      res.status(error.status || 500).json({ error: error.message }),
    );
    server = app.listen(0, '127.0.0.1');
    await new Promise((done) => server.once('listening', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, { method = 'GET', body, session } = {}) => {
      const result = await originalFetch(origin + path, {
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
    if (server) await new Promise((done) => server.close(done));
    rawDb?.close();
    globalThis.fetch = originalFetch;
    for (const [name, value] of saved)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    if (!resolve(directory).startsWith(resolve(join(tmpdir(), 'yoru-webmcp-http-'))))
      throw new Error('Unexpected test directory');
    await rm(directory, { recursive: true, force: true });
  }
});
