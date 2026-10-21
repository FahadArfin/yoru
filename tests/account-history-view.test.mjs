import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountSource, accountClassification } from './extension-account-contract.mjs';
test('local account history filters before its visible cap and requires current native source proof', async () => {
  const { visibleAccountHistory } = await import('../shared/reading-account-view.js');
  const source = accountSource(),
    id = 'ext-manga-' + 'a'.repeat(32);
  const item = {
    mediaId: id,
    updatedAt: 2,
    mediaSnapshot: {
      id,
      title: 'Saved native',
      category: 'MANGA',
      sourceRef: source,
      classification: accountClassification(),
    },
  };
  const context = {
    destination: 'yoru',
    extensionsEnabled: true,
    overrides: {},
    integrationMode: 'core',
  };
  assert.deepEqual(visibleAccountHistory([item], context), []);
  assert.deepEqual(visibleAccountHistory([item], context, { currentSources: [source] }), [item]);
  assert.deepEqual(
    visibleAccountHistory([item], context, { currentSources: [accountSource('123', 'adult')] }),
    [],
  );
  assert.deepEqual(
    visibleAccountHistory(
      [item],
      { ...context, overrides: { MangaDex: { yoru: false } } },
      { currentSources: [source] },
    ),
    [],
  );
  const core = {
    mediaId: 'mal-manga-21',
    updatedAt: 1,
    mediaSnapshot: { id: 'mal-manga-21', title: 'Core', category: 'MANGA', isAdult: false },
  };
  assert.deepEqual(visibleAccountHistory([item, core], context, { limit: 1 }), [core]);
  assert.deepEqual(
    visibleAccountHistory([{ mediaId: 'mal-manga-9999999', title: 'Unknown' }], context),
    [],
  );
  assert.deepEqual(
    visibleAccountHistory([item], context, {
      currentSources: [{ ...source, providerKey: 'Other' }],
    }),
    [],
  );
});
