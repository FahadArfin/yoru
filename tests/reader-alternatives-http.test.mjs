import express from 'express';
import { contextFixture } from './reader-context-fixture.mjs';
import {
  alternativesProvider,
  readerAlternativesHttpContract,
} from './reader-alternatives-http-contract.mjs';
import { registerNodeReaderRoutes } from '../server/reader-routes.js';
import { createExtensionGateway } from '../server/extension-gateway.js';
import { saveReaderContext } from '../server/reader-context.js';
readerAlternativesHttpContract('Node/SQLite HTTP', async () => {
  const f = contextFixture(),
    provider = alternativesProvider(),
    guest = 'a'.repeat(64),
    other = 'b'.repeat(64);
  let revision = 0;
  const bridge = createExtensionGateway({
    bridgeKey: 'fixture-bridge-key-more-than-32-characters',
    bridgeUrl: 'https://fixture.trycloudflare.com',
    extensionsEnabled: true,
    fetchImpl: (url, init) => provider.respond(new Request(url, init)),
  });
  const app = express(),
    router = express.Router();
  const cookie = (req) => req.headers.cookie?.split('=')[1] || guest;
  registerNodeReaderRoutes(router, {
    contextOptions: (_req, guestId) => ({ db: f.db, guestId, extensionsEnabled: true }),
    chapterOptions: (req) => ({ readerDb: f.db, context: req.readerContext, bridge }),
    coreSearch: async () => ({ items: [] }),
    cookie,
    asyncRoute: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
  });
  app.use('/api', router);
  app.use((error, _req, res, _next) =>
    res
      .status(error.status || 500)
      .set('cache-control', 'no-store')
      .json({
        error: error.expose ? error.message : 'Unavailable',
        ...(error.restartRequired ? { restartRequired: true } : {}),
      }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    ...f,
    provider,
    request: (path, { otherGuest = false } = {}) =>
      fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        headers: { cookie: `yoru_reader_guest=${otherGuest ? other : guest}` },
      }),
    select: async (selection) => {
      const result = await saveReaderContext(
        { destination: 'yoru', selection, expectedRevision: revision },
        { db: f.db, guestId: guest },
      );
      revision = result.revision;
    },
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      f.close();
    },
  };
});
