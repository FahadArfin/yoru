import { api, invalidateApi } from '../api.js';
import { catalogEnabled } from '../../shared/catalog-preferences.js';
import {
  selectionProjection,
  normalizeGuestSelection,
  validDestination,
  validIntegrationMode,
} from '../../shared/catalog-selection.js';

const KEY = 'yoru:catalog-overrides:guest:v1';
const MODE_KEY = 'yoru:reader-integration-modes:guest:v1';
export const CATALOG_PREFERENCES_EVENT = 'yoru:catalog-preferences';
export const READER_SELECTION_ACTION_EVENT = 'yoru:reader-selection-action';
const accounts = new Map();
const pending = new Map();
const versions = new Map();
export const catalogDestination = () =>
  typeof location !== 'undefined' && location.pathname.startsWith('/ara-ara') ? 'ara-ara' : 'yoru';
const empty = () => ({ overrides: {}, modes: { yoru: 'all', 'ara-ara': 'all' }, revision: 0 });
const guest = () => {
  let overrides = {},
    modes = {};
  try {
    overrides = normalizeGuestSelection({
      overrides: JSON.parse(localStorage.getItem(KEY)) || {},
    }).overrides;
  } catch {
    /* Optional guest storage. */
  }
  try {
    modes = normalizeGuestSelection({
      modes: JSON.parse(localStorage.getItem(MODE_KEY)) || {},
    }).modes;
  } catch {
    /* Optional guest storage. */
  }
  return { ...normalizeGuestSelection({ overrides, modes }), revision: 0 };
};
const current = (scope) => (scope === 'guest' ? guest() : accounts.get(scope)?.settings || empty());
const advance = (scope) => versions.set(scope, (versions.get(scope) || 0) + 1);
function accept(scope, data) {
  if (data.owner !== scope)
    throw new Error('Your account changed. Reload to sync catalog choices.');
  const cached = accounts.get(scope)?.settings;
  const revision = Number.isSafeInteger(data.revision) && data.revision >= 0 ? data.revision : 0;
  // Server revisions order concurrent writes even when HTTP responses arrive backwards.
  if (cached && revision < cached.revision) return cached;
  const settings = { ...selectionProjection(data), revision };
  accounts.set(scope, { settings, at: Date.now() });
  return settings;
}
function publish(scope, destination, action) {
  advance(scope);
  invalidateApi('/api/media/');
  window.dispatchEvent(new CustomEvent(CATALOG_PREFERENCES_EVENT, { detail: scope }));
  window.dispatchEvent(
    new CustomEvent(READER_SELECTION_ACTION_EVENT, { detail: { scope, destination, ...action } }),
  );
  return current(scope);
}
export async function loadReaderSettings(scope, force = false) {
  if (!scope) return empty();
  if (scope === 'guest') {
    try {
      const legacy = JSON.parse(localStorage.getItem('yoru:reader-catalogs:v1') || '{}');
      if (localStorage.getItem(KEY) === null && (legacy.enabled?.yoru || legacy.araEnabled?.yoru)) {
        if (pending.has(scope)) return pending.get(scope);
        const request = api('/api/reader/catalogs')
          .then((data) => {
            migrateGuestCatalogPreferences(data.sources);
            return guest();
          })
          .catch(() => guest())
          .finally(() => {
            if (pending.get(scope) === request) pending.delete(scope);
          });
        pending.set(scope, request);
        return request;
      }
    } catch {
      /* Storage is optional for guests. */
    }
    return guest();
  }
  const cached = accounts.get(scope);
  if (!force && cached && Date.now() - cached.at < 30000) return cached.settings;
  if (pending.has(scope)) return pending.get(scope);
  const version = versions.get(scope) || 0;
  const request = api('/api/reader/preferences')
    .then((data) => {
      if (data.owner !== scope)
        throw new Error('Your account changed. Reload to sync catalog choices.');
      if ((versions.get(scope) || 0) !== version) return current(scope);
      return accept(scope, data);
    })
    .finally(() => {
      if (pending.get(scope) === request) pending.delete(scope);
    });
  pending.set(scope, request);
  return request;
}
// Keep the shipped membership-only interface for existing reading and Settings consumers.
export async function loadCatalogPreferences(scope, force = false) {
  return (await loadReaderSettings(scope, force)).overrides;
}
export async function saveCatalogPreference(scope, provider, destination, enabled) {
  if (!scope) throw new Error('Wait for your account to load.');
  advance(scope);
  if (scope === 'guest') {
    const old = guest().overrides;
    const overrides = normalizeGuestSelection({
      overrides: { ...old, [provider]: { ...old[provider], [destination]: enabled } },
    }).overrides;
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } else {
    accept(
      scope,
      await api('/api/reader/preferences', {
        method: 'PATCH',
        body: JSON.stringify({
          owner: scope,
          operation: 'membership',
          provider,
          destination,
          enabled,
        }),
      }),
    );
  }
  return publish(scope, destination).overrides;
}
export async function saveIntegrationMode(scope, destination, mode) {
  if (!scope) throw new Error('Wait for your account to load.');
  if (!validDestination(destination) || !validIntegrationMode(mode))
    throw new Error('Invalid integration mode.');
  advance(scope);
  if (scope === 'guest') {
    localStorage.setItem(MODE_KEY, JSON.stringify({ ...guest().modes, [destination]: mode }));
  } else {
    accept(
      scope,
      await api('/api/reader/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ owner: scope, operation: 'mode', destination, mode }),
      }),
    );
  }
  return publish(scope, destination, { kind: 'integration', requestedMode: mode }).modes;
}
export async function resetCatalogPreferences(scope) {
  if (!scope) throw new Error('Wait for your account to load.');
  advance(scope);
  if (scope === 'guest') {
    localStorage.setItem(KEY, '{}');
    localStorage.setItem(MODE_KEY, JSON.stringify(empty().modes));
  } else {
    accept(
      scope,
      await api('/api/reader/preferences', {
        method: 'DELETE',
        body: JSON.stringify({ owner: scope }),
      }),
    );
  }
  return publish(scope, null).overrides;
}
export function migrateGuestCatalogPreferences(sources) {
  if (localStorage.getItem(KEY) !== null) return;
  const data = JSON.parse(localStorage.getItem('yoru:reader-catalogs:v1') || '{}');
  const overrides = Object.create(null);
  for (const name of new Set(sources.map((s) => s.name))) {
    for (const [destination, values] of [
      ['yoru', data.enabled?.yoru],
      ['ara-ara', data.araEnabled?.yoru],
    ]) {
      const editions = sources.filter(
        (s) => s.name === name && typeof values?.[s.id] === 'boolean',
      );
      if (!editions.length) continue;
      const enabled = editions.every((s) => values[s.id]);
      if (enabled !== catalogEnabled(name, destination)) {
        overrides[name] ||= {};
        overrides[name][destination] = enabled;
      }
    }
  }
  localStorage.setItem(KEY, JSON.stringify(overrides));
}
