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
