import { send } from './api.js';

let queue = Promise.resolve();
export function recordView(id, reading = false) {
  const record = () => send(`/api/media/${id}/${reading ? 'read-view' : 'view'}`, {});
  return recordVisitorAction(record);
}
export function recordChapterView(id, chapterId) {
  return recordVisitorAction(() => send(`/api/media/${id}/chapters/${chapterId}/open`, {}));
}
function recordVisitorAction(record) {
  // The first response establishes the HttpOnly visitor cookie. Coordinate
  // same-origin tabs so another request cannot mint a second identity first.
  if (globalThis.navigator?.locks) return navigator.locks.request('yoru-watch-view', record);
  const result = queue.then(record, record);
  queue = result.catch(() => {});
  return result;
}
