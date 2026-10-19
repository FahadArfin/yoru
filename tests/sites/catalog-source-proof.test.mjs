import { catalogSourceProofContract } from '../catalog-source-proof-contract.mjs';
import { createRuntime, migrate } from './harness.mjs';
import { sitesReaderDb, store } from '../../sites/store.js';

catalogSourceProofContract('D1 source authority', async () => {
  const runtime = await createRuntime();
  try {
    await migrate(runtime);
    return {
      db: sitesReaderDb(store(await runtime.getD1Database('DB', 'a'))),
      close: () => runtime.dispose(),
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
});
