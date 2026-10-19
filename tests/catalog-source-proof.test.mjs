import { contextFixture } from './reader-context-fixture.mjs';
import { catalogSourceProofContract } from './catalog-source-proof-contract.mjs';

catalogSourceProofContract('SQLite', async () => contextFixture());
