import { apiError } from './validation.js';
import { catalogDefaults } from '../shared/catalog-preferences.js';
import {
  selectionProjection,
  validIntegrationMode,
  validDestination,
} from '../shared/catalog-selection.js';

export const catalogPreferenceSchema = `CREATE TABLE IF NOT EXISTS reader_catalog_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, destination TEXT NOT NULL, enabled INTEGER NOT NULL,
  PRIMARY KEY(user_id,provider,destination)
);
CREATE TABLE IF NOT EXISTS reader_settings (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modes TEXT NOT NULL DEFAULT '{"yoru":"all","ara-ara":"all"}',
  revision INTEGER NOT NULL DEFAULT 0
);`;
const defaultModes = () => ({ yoru: 'all', 'ara-ara': 'all' });
const reads = (userId) => [
  {
    sql: 'SELECT provider,destination,enabled FROM reader_catalog_preferences WHERE user_id=? ORDER BY provider,destination',
    values: [userId],
  },
  { sql: 'SELECT modes,revision FROM reader_settings WHERE user_id=?', values: [userId] },
];
function snapshot(userId, [memberships, settings]) {
  const overrides = Object.create(null);
  for (const row of memberships) {
    if (!Object.hasOwn(overrides, row.provider)) overrides[row.provider] = {};
    overrides[row.provider][row.destination] = !!row.enabled;
  }
  const row = settings[0];
  const modes = row ? selectionProjection({ modes: JSON.parse(row.modes) }).modes : defaultModes();
  return {
    owner: userId || null,
    defaults: catalogDefaults,
    overrides: { ...overrides },
    modes,
    revision: row?.revision ?? 0,
  };
}
export async function getCatalogPreferences({ db, userId }) {
  return snapshot(userId, userId ? await db.atomic(reads(userId)) : [[], []]);
}
function owner(input, options) {
  if (!options.userId) throw apiError(401, 'Sign in to continue.');
  if (input?.owner !== options.userId)
    throw apiError(409, 'Your account changed. Reload to save preferences.');
}
async function write(statements, options) {
  const { db, userId, sessionHash } = options;
  const results = await db.atomic(
    [...statements, ...reads(userId)],
    sessionHash ? { userId, sessionHash } : undefined,
  );
  return snapshot(userId, results.slice(-2));
}
const bumpRevision = (userId) => ({
  sql: `INSERT INTO reader_settings(user_id,revision) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET revision=reader_settings.revision+1`,
  values: [userId],
});

// Missing operation is the shipped membership PATCH format. It must never be
// inferred from a mode field or used as an account selector.
export async function changeReaderPreference(input, options) {
  if (input?.operation === 'mode') return changeIntegrationMode(input, options);
  if (input?.operation === undefined || input.operation === 'membership')
    return changeCatalogPreference(input, options);
  throw apiError(400, 'Invalid preference operation.');
}
export async function changeCatalogPreference(input, options) {
  owner(input, options);
  if (
    typeof input.provider !== 'string' ||
    !input.provider.trim() ||
    input.provider.length > 100 ||
    /[\x00-\x1f]/.test(input.provider) ||
    ['__proto__', 'constructor', 'prototype'].includes(input.provider) ||
    !validDestination(input.destination) ||
    typeof input.enabled !== 'boolean'
  )
    throw apiError(400, 'Invalid catalog preference.');
  return write(
    [
      {
        sql: `INSERT INTO reader_catalog_preferences(user_id,provider,destination,enabled) VALUES(?,?,?,?) ON CONFLICT(user_id,provider,destination) DO UPDATE SET enabled=excluded.enabled`,
        values: [options.userId, input.provider, input.destination, Number(input.enabled)],
      },
      bumpRevision(options.userId),
    ],
    options,
  );
}
export async function changeIntegrationMode(input, options) {
  owner(input, options);
  if (!validDestination(input.destination) || !validIntegrationMode(input.mode))
    throw apiError(400, 'Invalid integration mode.');
  return write(
    [
      {
        sql: `INSERT INTO reader_settings(user_id,modes,revision) VALUES(?,json_set(?, ?, ?),1) ON CONFLICT(user_id) DO UPDATE SET modes=json_set(reader_settings.modes, ?, ?),revision=reader_settings.revision+1`,
        values: [
          options.userId,
          JSON.stringify(defaultModes()),
          `$."${input.destination}"`,
          input.mode,
          `$."${input.destination}"`,
          input.mode,
        ],
      },
    ],
    options,
  );
}
export async function resetCatalogPreferences(input, options) {
  owner(input, options);
  return write(
    [
      { sql: 'DELETE FROM reader_catalog_preferences WHERE user_id=?', values: [options.userId] },
      {
        sql: `INSERT INTO reader_settings(user_id,modes,revision) VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET modes=excluded.modes,revision=reader_settings.revision+1`,
        values: [options.userId, JSON.stringify(defaultModes())],
      },
    ],
    options,
  );
}
