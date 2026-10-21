import { Response } from 'miniflare';
import { createRuntime, migrate } from './harness.mjs';
import { store, sitesReaderDb } from '../../sites/store.js';
import {
  alternativesProvider,
  readerAlternativesHttpContract,
} from '../reader-alternatives-http-contract.mjs';
readerAlternativesHttpContract('D1 alternating Workers HTTP', async () => {
  const provider = alternativesProvider();
  const runtime = await createRuntime({
    bindings: {
      CATALOG_OFFLINE: '0',
      READER_EXTENSIONS_ENABLED: '1',
      READER_BRIDGE_KEY: 'fixture-bridge-key-more-than-32-characters',
      READER_BRIDGE_URL: 'https://fixture.trycloudflare.com',
    },
    provider: (request) => provider.respond(request, Response),
  });
  try {
    await migrate(runtime);
    const db = sitesReaderDb(store(await runtime.getD1Database('DB', 'a')));
    let n = 0,
      revision = 0;
    const guest = 'a'.repeat(64),
      other = 'b'.repeat(64);
    const request = (path, { otherGuest = false, method = 'GET', body } = {}) => {
      const origin = `http://${n++ % 2 ? 'b' : 'a'}.test`;
      return runtime.dispatchFetch(origin + path, {
        method,
        headers: {
          origin,
          cookie: `yoru_reader_guest=${otherGuest ? other : guest}`,
          'content-type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    };
    return {
      db,
      provider,
      request,
      select: async (selection) => {
        const response = await request('/api/reader/context', {
          method: 'POST',
          body: { destination: 'yoru', selection, expectedRevision: revision },
        });
        const body = await response.json();
        revision = body.revision;
      },
      close: () => runtime.dispose(),
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
});
