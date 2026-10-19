import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

test('provider defaults apply across languages and personal choices override only their destination', async () => {
  const { catalogEnabled, filterReadingSources } = await import('../shared/catalog-preferences.js');
  assert.equal(catalogEnabled('NineHentai', 'yoru'), false);
  assert.equal(catalogEnabled('NineHentai', 'ara-ara'), true);
  assert.equal(catalogEnabled('Aunt Manhwa', 'yoru'), true);
  assert.equal(catalogEnabled('Aunt Manhwa', 'ara-ara'), true);
  assert.equal(catalogEnabled('New unknown provider', 'yoru'), false);
  const overrides = { MangaDex: { yoru: false } };
  assert.deepEqual(
    filterReadingSources(
      [
        { id: 'mangadex', name: 'MangaDex' },
        { id: 'weebcentral', name: 'Weeb Central' },
      ],
      'yoru',
      overrides,
    ).map((s) => s.id),
    ['weebcentral'],
  );
  assert.equal(catalogEnabled('MangaDex', 'ara-ara', overrides), false);
});

test('account writes cannot select another owner and independent provider changes survive reset', async () => {
  const {
    catalogPreferenceSchema,
    getCatalogPreferences,
    changeCatalogPreference,
    resetCatalogPreferences,
  } = await import('../server/catalog-preferences.js');
  const sql = new DatabaseSync(':memory:');
  sql.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('one'),('two');");
  sql.exec(catalogPreferenceSchema);
  const db = {
    all: (q, ...v) => sql.prepare(q).all(...v),
    run: (q, ...v) => sql.prepare(q).run(...v),
  };
  const one = { db, userId: 'one' },
    two = { db, userId: 'two' };
  await assert.rejects(
    changeCatalogPreference(
      { owner: 'two', provider: 'MangaDex', destination: 'yoru', enabled: false },
      one,
    ),
    /account changed/,
  );
  await assert.rejects(
    changeCatalogPreference(
      { owner: 'one', provider: 'MangaDex', destination: 'yoru', enabled: 'false' },
      one,
    ),
    /Invalid/,
  );
  await changeCatalogPreference(
    { owner: 'one', provider: 'MangaDex', destination: 'yoru', enabled: false },
    one,
  );
  await changeCatalogPreference(
    { owner: 'one', provider: 'Weeb Central', destination: 'ara-ara', enabled: true },
    one,
  );
  assert.deepEqual((await getCatalogPreferences(two)).overrides, {});
  assert.deepEqual((await getCatalogPreferences(one)).overrides, {
    MangaDex: { yoru: false },
    'Weeb Central': { 'ara-ara': true },
  });
  await resetCatalogPreferences({ owner: 'one' }, one);
  assert.deepEqual((await getCatalogPreferences(one)).overrides, {});
  sql.close();
});
