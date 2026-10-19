import { apiError } from './validation.js';
import { catalogDefaults } from '../shared/catalog-preferences.js';

export const catalogPreferenceSchema = `CREATE TABLE IF NOT EXISTS reader_catalog_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, destination TEXT NOT NULL, enabled INTEGER NOT NULL,
  PRIMARY KEY(user_id,provider,destination)
);`;
export async function getCatalogPreferences({ db, userId }) {
  const overrides = Object.create(null);
  if (userId)
    for (const row of await db.all(
      'SELECT provider,destination,enabled FROM reader_catalog_preferences WHERE user_id=? ORDER BY provider,destination',
      userId,
    )) {
      if (!Object.hasOwn(overrides, row.provider)) overrides[row.provider] = {};
      overrides[row.provider][row.destination] = !!row.enabled;
    }
  return { owner: userId || null, defaults: catalogDefaults, overrides: { ...overrides } };
}
function owner(input, options) {
  if (!options.userId) throw apiError(401, 'Sign in to continue.');
  if (input?.owner !== options.userId)
    throw apiError(409, 'Your account changed. Reload to save preferences.');
}
export async function changeCatalogPreference(input, options) {
  owner(input, options);
  if (
    typeof input.provider !== 'string' ||
    !input.provider.trim() ||
    input.provider.length > 100 ||
    /[\x00-\x1f]/.test(input.provider) ||
    ['__proto__', 'constructor', 'prototype'].includes(input.provider) ||
    !['yoru', 'ara-ara'].includes(input.destination) ||
    typeof input.enabled !== 'boolean'
  )
    throw apiError(400, 'Invalid catalog preference.');
  await options.db.run(
    `INSERT INTO reader_catalog_preferences(user_id,provider,destination,enabled) VALUES(?,?,?,?) ON CONFLICT(user_id,provider,destination) DO UPDATE SET enabled=excluded.enabled`,
    options.userId,
    input.provider,
    input.destination,
    Number(input.enabled),
  );
  return getCatalogPreferences(options);
}
export async function resetCatalogPreferences(input, options) {
  owner(input, options);
  await options.db.run('DELETE FROM reader_catalog_preferences WHERE user_id=?', options.userId);
  return getCatalogPreferences(options);
}
