import seed from '../server/seed.json';
import { AsyncLocalStorage } from 'node:async_hooks';
const requests = new AsyncLocalStorage();
export const withCatalog = (env, ctx, callback) =>
  requests.run({ env, ctx, pending: new Map(), requestQueue: Promise.resolve() }, callback);
export const getRequestState = () => requests.getStore();
export const isOffline = () => requests.getStore()?.env.CATALOG_OFFLINE === '1';
export const background = (promise) => requests.getStore().ctx.waitUntil(promise.catch(() => {}));
export { seed };
export const persisted = null;
// Provider metadata is a cache; authoritative library/import records live in D1.
export function saveCatalog() {}

export async function loadSearch(key) {
  const row = await requests
    .getStore()
    .env.DB.prepare('SELECT payload, fetched_at FROM catalog_pages WHERE query_key=?')
    .bind(key)
    .first();
  if (!row) return null;
  const saved = JSON.parse(row.payload);
  saved.result.fetchedAt = row.fetched_at;
  return saved;
}

export async function saveSearch(key, result, items) {
  // Do not replace a complete last-known-good page with a partial provider response.
  if (result.partial) return;
  await requests
    .getStore()
    .env.DB.prepare(
      `INSERT INTO catalog_pages(query_key,payload,fetched_at) VALUES(?,?,?)
     ON CONFLICT(query_key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at
     WHERE excluded.fetched_at>=catalog_pages.fetched_at`,
    )
    .bind(key, JSON.stringify({ result, items }), result.fetchedAt)
    .run();
}

export async function loadMedia(id) {
  const row = await requests
    .getStore()
    .env.DB.prepare('SELECT payload FROM catalog_media WHERE id=?')
    .bind(id)
    .first();
  return row ? JSON.parse(row.payload) : null;
}

export async function loadAccountMedia(ids) {
  if (!ids.length) return [];
  if (ids.length > 5000) throw new Error('Account metadata batch too large.');
  const result = await requests
    .getStore()
    .env.DB.prepare(
      `SELECT payload FROM catalog_media WHERE id IN (SELECT value FROM json_each(?))
       UNION ALL SELECT metadata AS payload FROM imported_media WHERE media_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids), JSON.stringify(ids))
    .all();
  return result.results.map((row) => JSON.parse(row.payload));
}

export async function saveMedia(item) {
  if (!item || item.imported || item.isAdult) return;
  await requests
    .getStore()
    .env.DB.prepare(
      `INSERT INTO catalog_media(id,payload,fetched_at) VALUES(?,?,?)
     ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at
     WHERE excluded.fetched_at>=catalog_media.fetched_at
       AND (COALESCE(json_extract(catalog_media.payload,'$.detailed'),0)=0
         OR COALESCE(json_extract(excluded.payload,'$.detailed'),0)=1)`,
    )
    .bind(item.id, JSON.stringify(item), Date.parse(item.metadataFetchedAt) || Date.now())
    .run();
}
