import { api, invalidateApi } from '../api.js';
import { catalogEnabled } from '../../shared/catalog-preferences.js';

const KEY = 'yoru:catalog-overrides:guest:v1';
export const CATALOG_PREFERENCES_EVENT = 'yoru:catalog-preferences';
const accounts = new Map();
const pending = new Map();
const versions = new Map();
export const catalogDestination = () =>
  typeof location !== 'undefined' && location.pathname.startsWith('/ara-ara') ? 'ara-ara' : 'yoru';
const guest = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
};
function publish(scope, overrides) {
  versions.set(scope, (versions.get(scope) || 0) + 1);
  if (scope !== 'guest') accounts.set(scope, { overrides, at: Date.now() });
  invalidateApi('/api/media/');
  window.dispatchEvent(new CustomEvent(CATALOG_PREFERENCES_EVENT, { detail: scope }));
  return overrides;
}
export async function loadCatalogPreferences(scope, force = false) {
  if (!scope) return {};
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
          .finally(() => pending.delete(scope));
        pending.set(scope, request);
        return request;
      }
    } catch {
      /* Storage is optional for guests. */
    }
    return guest();
  }
  const cached = accounts.get(scope);
  if (!force && cached && Date.now() - cached.at < 30000) return cached.overrides;
  if (pending.has(scope)) return pending.get(scope);
  const version = versions.get(scope) || 0;
  const request = api('/api/reader/preferences')
    .then((data) => {
      if (data.owner !== scope)
        throw new Error('Your account changed. Reload to sync catalog choices.');
      if ((versions.get(scope) || 0) !== version) return accounts.get(scope)?.overrides || {};
      accounts.set(scope, { overrides: data.overrides, at: Date.now() });
      return data.overrides;
    })
    .finally(() => pending.delete(scope));
  pending.set(scope, request);
  return request;
}
export async function saveCatalogPreference(scope, provider, destination, enabled) {
  if (!scope) throw new Error('Wait for your account to load.');
  let overrides;
  if (scope === 'guest') {
    const old = guest();
    overrides = { ...old, [provider]: { ...old[provider], [destination]: enabled } };
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } else {
    const result = await api('/api/reader/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ owner: scope, provider, destination, enabled }),
    });
    if (result.owner !== scope)
      throw new Error('Your account changed. Reload to sync catalog choices.');
    overrides = result.overrides;
  }
  return publish(scope, overrides);
}
export async function resetCatalogPreferences(scope) {
  if (!scope) throw new Error('Wait for your account to load.');
  if (scope === 'guest') localStorage.setItem(KEY, '{}');
  else {
    const result = await api('/api/reader/preferences', {
      method: 'DELETE',
      body: JSON.stringify({ owner: scope }),
    });
    if (result.owner !== scope)
      throw new Error('Your account changed. Reload to sync catalog choices.');
  }
  return publish(scope, {});
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
