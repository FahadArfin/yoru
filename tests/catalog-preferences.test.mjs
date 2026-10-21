import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { nodeReaderDb } from '../server/reader-db.js';
import { readerSettingsContract } from './reader-settings-contract.mjs';
import {
  catalogDefaults,
  catalogEnabled,
  sourceSupportsReadingCategory,
  readingTitleCategory,
} from '../shared/catalog-preferences.js';

test('Manhwa source coverage recognizes exact package families, not language or name fragments', () => {
  for (const providerKey of [
    'Manhwa18.cc',
    'ManhwaClub.net',
    'Aunt Manhwa',
    'eu.kanade.tachiyomi.extension.all.manhwa18cc',
  ])
    assert.equal(sourceSupportsReadingCategory({ providerKey }, 'manhwa'), true);
  for (const providerKey of [
    '3Hentai',
    'eu.kanade.tachiyomi.extension.all.hentai3',
    'NHentai.to',
    'Unknown Manhwa',
  ]) {
    assert.equal(sourceSupportsReadingCategory({ providerKey, language: 'ko' }, 'manhwa'), false);
    assert.equal(sourceSupportsReadingCategory({ providerKey }, 'manga'), true);
  }
  assert.equal(readingTitleCategory({ category: 'MANGA', genres: ['Manhwa'] }), 'MANHWA');
  assert.equal(
    readingTitleCategory({ category: 'MANGA', genres: ['Webtoon', 'Full Color'] }),
    'MANGA',
  );
  assert.equal(readingTitleCategory({ genres: 'Manhwa' }), 'MANGA');
});

function database(sql) {
  return nodeReaderDb({
    get: (q, ...v) => sql.prepare(q).get(...v),
    all: (q, ...v) => sql.prepare(q).all(...v),
    run: (q, ...v) => sql.prepare(q).run(...v),
    transaction(callback) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        const result = callback();
        sql.exec('COMMIT');
        return result;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  });
}

readerSettingsContract('SQLite', async () => {
  const { catalogPreferenceSchema } = await import('../server/catalog-preferences.js');
  const sql = new DatabaseSync(':memory:');
  sql.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('one'),('two'); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER); INSERT INTO sessions VALUES ('one-session','one',9999999999999);",
  );
  sql.exec(catalogPreferenceSchema);
  return { db: database(sql), close: () => sql.close() };
});

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

test('installed package families preserve all 21 saved defaults and conservative alias overrides', () => {
  const installed = [
    ['all.allporncomicsco', 'AllPornComics.co'],
    ['all.cubari', 'Cubari'],
    ['all.hennojin', 'Hennojin'],
    ['all.hentai3', '3Hentai'],
    ['all.hentaihand', 'HentaiHand'],
    ['all.luscious', 'Luscious'],
    ['all.mangadex', 'MangaDex'],
    ['all.manhwa18cc', 'Manhwa18.cc'],
    ['all.manhwaclubnet', 'ManhwaClub.net'],
    ['all.nhentaito', 'NHentai.to'],
    ['all.nhentaixxx', 'NHentai.xxx'],
    ['all.webcomics', 'Webcomics'],
    ['all.webtoons', 'Webtoons.com'],
    ['en.auntmanhwa', 'Aunt Manhwa'],
    ['en.frierenonline', 'Frieren Online'],
    ['en.hentaixdickgirl', 'HentaiXDickgirl'],
    ['en.hentaixyuri', 'HentaiXYuri'],
    ['en.mangakakalot', 'Mangakakalot'],
    ['en.manhwacomics', 'Manhwa Comics'],
    ['en.ninehentai', 'NineHentai'],
    ['en.weebcentral', 'Weeb Central'],
  ];
  assert.equal(Object.keys(catalogDefaults).length, 21);
  for (const [suffix, family] of installed) {
    const pkg = `eu.kanade.tachiyomi.extension.${suffix}`;
    for (const destination of ['yoru', 'ara-ara']) {
      assert.equal(
        catalogEnabled(pkg, destination),
        catalogDefaults[family][destination],
        `${family} ${destination}`,
      );
      for (const provider of [pkg, family]) {
        assert.equal(
          catalogEnabled(provider, destination, {
            [family]: { [destination]: false },
            [pkg]: { [destination]: true },
          }),
          false,
        );
        assert.equal(
          catalogEnabled(provider, destination, {
            [family]: { [destination]: true },
            [pkg]: { [destination]: false },
          }),
          false,
        );
        assert.equal(
          catalogEnabled(provider, destination, { [family]: { [destination]: true } }),
          true,
        );
        assert.equal(
          catalogEnabled(provider, destination, { [pkg]: { [destination]: true } }),
          true,
        );
        assert.equal(
          catalogEnabled(provider, destination, {}),
          catalogDefaults[family][destination],
          'reset restores unchanged defaults',
        );
      }
    }
  }
  for (const unknown of [
    'eu.kanade.tachiyomi.extension.en.newprovider',
    'other.extension.all.webtoons',
    'eu.kanade.tachiyomi.extension.zz.webtoons',
  ]) {
    assert.equal(catalogEnabled(unknown, 'yoru'), false);
    assert.equal(catalogEnabled(unknown, 'ara-ara'), false);
    assert.equal(
      catalogEnabled(unknown, 'yoru', { [unknown]: { yoru: true } }),
      true,
      'explicit unknown-provider opt-in remains supported',
    );
  }
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
  const db = database(sql);
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
