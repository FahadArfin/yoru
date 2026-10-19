import { identityContract } from '../extension-identity-contract.mjs';
import { createRuntime, migrate } from './harness.mjs';

identityContract('D1 across Workers', async () => {
  const { sitesReaderDb, store } = await import('../../sites/store.js');
  const { createExternalCatalogStore } = await import('../../server/external-catalog-store.js');
  const runtime = await createRuntime();
  try {
    await migrate(runtime);
    const a = sitesReaderDb(store(await runtime.getD1Database('DB', 'a')));
    const b = sitesReaderDb(store(await runtime.getD1Database('DB', 'b')));
    return {
      db: () => a,
      open: () => createExternalCatalogStore(a),
      reopen: () => createExternalCatalogStore(b),
      close: () => runtime.dispose(),
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
});
