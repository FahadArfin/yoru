import { send } from './api.js';

let queue = Promise.resolve();
export function recordView(id) {
  const record = () => send(`/api/media/${id}/view`, {});
  // The first response establishes the HttpOnly visitor cookie. Coordinate
  // same-origin tabs so another request cannot mint a second identity first.
  if (globalThis.navigator?.locks) return navigator.locks.request('yoru-watch-view', record);
  const result = queue.then(record, record);
  queue = result.catch(() => {});
  return result;
}
