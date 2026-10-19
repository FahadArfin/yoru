import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as preferences from '../server/catalog-preferences.js';

export function readerSettingsContract(label, createFixture) {
  test(`${label}: integration settings reset both destinations atomically`, async () => {
    const fixture = await createFixture();
    try {
      const one = { db: fixture.db, userId: 'one', sessionHash: 'one-session' };
      const initial = await preferences.getCatalogPreferences(one);
      assert.deepEqual(initial.modes, { yoru: 'all', 'ara-ara': 'all' });
      assert.equal(initial.revision, 0);
      await Promise.all([
        preferences.changeCatalogPreference(
          { owner: 'one', provider: 'MangaDex', destination: 'yoru', enabled: false },
          one,
        ),
        preferences.changeCatalogPreference(
          { owner: 'one', provider: 'Weeb Central', destination: 'ara-ara', enabled: true },
          one,
        ),
      ]);
      await Promise.all([
        preferences.changeIntegrationMode({ owner: 'one', destination: 'yoru', mode: 'core' }, one),
        preferences.changeIntegrationMode(
          { owner: 'one', destination: 'ara-ara', mode: 'extensions' },
          one,
        ),
      ]);
      const saved = await preferences.getCatalogPreferences(one);
      assert.deepEqual(saved.overrides, {
        MangaDex: { yoru: false },
        'Weeb Central': { 'ara-ara': true },
      });
      assert.deepEqual(saved.modes, { yoru: 'core', 'ara-ara': 'extensions' });
      assert.equal(saved.revision, 4);
      assert.deepEqual(
        (await preferences.getCatalogPreferences({ db: fixture.db, userId: 'two' })).modes,
        { yoru: 'all', 'ara-ara': 'all' },
      );
      const reset = await preferences.resetCatalogPreferences({ owner: 'one' }, one);
      assert.deepEqual(reset.modes, { yoru: 'all', 'ara-ara': 'all' });
      assert.deepEqual(reset.overrides, {});
      assert.equal(reset.revision, 5);
      assert.deepEqual(await preferences.getCatalogPreferences(one), reset);
    } finally {
      await fixture.close();
    }
  });

  test(`${label}: revoked sessions cannot change membership modes or revision`, async () => {
    const fixture = await createFixture();
    try {
      const options = { db: fixture.db, userId: 'one', sessionHash: 'one-session' };
      await preferences.changeCatalogPreference(
        { owner: 'one', provider: 'MangaDex', destination: 'yoru', enabled: false },
        options,
      );
      const before = await preferences.getCatalogPreferences(options);
      await fixture.db.run('DELETE FROM sessions WHERE user_id=?', 'one');
      await assert.rejects(
        preferences.changeCatalogPreference(
          { owner: 'one', provider: 'MangaDex', destination: 'yoru', enabled: true },
          options,
        ),
        /session changed/,
      );
      await assert.rejects(
        preferences.changeIntegrationMode(
          { owner: 'one', destination: 'yoru', mode: 'core' },
          options,
        ),
        /session changed/,
      );
      await assert.rejects(
        preferences.resetCatalogPreferences({ owner: 'one' }, options),
        /session changed/,
      );
      assert.deepEqual(await preferences.getCatalogPreferences(options), before);
    } finally {
      await fixture.close();
    }
  });

  test(`${label}: a failed revision write rolls back membership updates and global reset`, async () => {
    const fixture = await createFixture();
    try {
      const options = { db: fixture.db, userId: 'one', sessionHash: 'one-session' };
      await preferences.changeCatalogPreference(
        { owner: 'one', provider: 'MangaDex', destination: 'yoru', enabled: false },
        options,
      );
      await preferences.changeIntegrationMode(
        { owner: 'one', destination: 'ara-ara', mode: 'extensions' },
        options,
      );
      const before = await preferences.getCatalogPreferences(options);
      // A real database failure after the membership statement must roll back
      // that statement, rather than leaving memberships and revision split.
      await fixture.db.run(
        "CREATE TRIGGER reject_reader_revision BEFORE UPDATE ON reader_settings BEGIN SELECT RAISE(ABORT,'revision write failed'); END",
      );
      await assert.rejects(
        preferences.changeCatalogPreference(
          { owner: 'one', provider: 'MangaDex', destination: 'yoru', enabled: true },
          options,
        ),
        /revision write failed/,
      );
      assert.deepEqual(await preferences.getCatalogPreferences(options), before);
      await assert.rejects(
        preferences.resetCatalogPreferences({ owner: 'one' }, options),
        /revision write failed/,
      );
      assert.deepEqual(await preferences.getCatalogPreferences(options), before);
    } finally {
      await fixture.close();
    }
  });
}
