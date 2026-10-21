import { sortChapters } from './model.js';
import { parseMediaReference } from '../../shared/media-reference.js';
import { visibleAccountHistory } from '../../shared/reading-account-view.js';

const PREFIX = 'yoru:reader:state:';
let account = '';
const statePrefix = () => (account ? `yoru:reader:account:${account}:` : PREFIX);
export function setReaderAccount(id) {
  account = id || '';
  window.dispatchEvent(new Event(READER_EVENT));
}
export const READER_EVENT = 'yoru-reader-change';
let database;
function openDatabase() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('yoru-reader', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('collections', { keyPath: 'mediaId' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error('This browser could not open local chapter storage.'));
      request.onblocked = () => reject(new Error('Close other Yoru tabs and try importing again.'));
    }).catch((error) => {
      database = null;
      throw error;
    });
  return database;
}
export async function loadCollection(mediaId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction('collections', 'readonly')
      .objectStore('collections')
      .get(mediaId);
    request.onsuccess = () => {
      const data = request.result;
      resolve(data?.mediaId === mediaId && Array.isArray(data.chapters) ? data.chapters : []);
    };
    request.onerror = () => reject(new Error('Your saved chapters could not be loaded.'));
  });
}
export async function saveChapters(mediaId, chapters) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('collections', 'readwrite');
    const store = transaction.objectStore('collections');
    let merged;
    const request = store.get(mediaId);
    request.onsuccess = () => {
      const previous = request.result?.chapters || [];
      const byId = new Map(previous.map((chapter) => [chapter.id, chapter]));
      for (const chapter of chapters) byId.set(chapter.id, chapter);
      merged = sortChapters([...byId.values()]);
      if (merged.length > 1000) {
        transaction.abort();
        return;
      }
      store.put({ mediaId, chapters: merged });
    };
    transaction.oncomplete = () => {
      window.dispatchEvent(new Event(READER_EVENT));
      resolve(merged);
    };
    transaction.onerror = transaction.onabort = () =>
      reject(
        new Error(
          'Chapters could not be saved. Check device storage; a title can hold up to 1,000 editions.',
        ),
      );
  });
}
export async function imageChapter(
  files,
  { number, title, language = 'en', group = 'Local files' },
) {
  const list = [...files].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  if (!list.length || list.length > 500) throw new Error('Choose between 1 and 500 page images.');
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(number))
    throw new Error('Enter a chapter number, such as 1 or 1.5.');
  if (
    list.some(
      (file) =>
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type),
    )
  )
    throw new Error('Choose JPG, PNG, WebP, GIF or AVIF images.');
  if (list.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024)
    throw new Error('Keep each chapter below 100 MB.');
  const pages = [];
  for (const file of list) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error(`${file.name} could not be opened as an image.`);
    }
    pages.push({ blob: file, width: bitmap.width, height: bitmap.height });
    bitmap.close();
  }
  return {
    id: ['local', number, language, group].map(encodeURIComponent).join(':'),
    number,
    title,
    language,
    group,
    volume: '',
    pages,
    origin: 'files',
  };
}
export function getReadingState(id) {
  try {
    const state = JSON.parse(localStorage.getItem(statePrefix() + id));
    return state && typeof state === 'object' && !Array.isArray(state)
      ? {
          ...state,
          chapters: state.chapters && typeof state.chapters === 'object' ? state.chapters : {},
        }
      : { chapters: {} };
  } catch {
    return { chapters: {} };
  }
}
export function saveReadingState(id, patch, chapterId, chapterPatch) {
  const old = getReadingState(id);
  const next = { ...old, ...patch, updatedAt: Date.now() };
  if (chapterId)
    next.chapters = {
      ...old.chapters,
      [chapterId]: { ...old.chapters[chapterId], ...chapterPatch },
    };
  if (account && chapterId && chapterPatch) {
    next.markerPending = { ...old.markerPending };
    const pending = { ...next.markerPending[chapterId] };
    for (const field of ['bookmark', 'read'])
      if (Object.hasOwn(chapterPatch, field)) {
        const at = Math.max(Date.now(), (old.chapters[chapterId]?.[field + 'At'] || 0) + 1);
        pending[field] = { value: chapterPatch[field], at };
        next.chapters[chapterId][field + 'At'] = at;
      }
    if (Object.keys(pending).length) next.markerPending[chapterId] = pending;
  }
  try {
    localStorage.setItem(statePrefix() + id, JSON.stringify(next));
  } catch {
    throw new Error('Your browser could not save your reading position. Reading still works.');
  }
  window.dispatchEvent(
    new CustomEvent(READER_EVENT, {
      detail: {
        id,
        markers:
          !!chapterPatch &&
          ['bookmark', 'read'].some((field) => Object.hasOwn(chapterPatch, field)),
      },
    }),
  );
  return next;
}
export function readingHistory(category, context, options = {}) {
  const prefix = statePrefix();
  try {
    const stored = Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({
        mediaId: key.slice(prefix.length),
        ...getReadingState(key.slice(prefix.length)),
      }))
      .filter(
        (item) =>
          item.category === category && item.lastChapter && item.chapters[item.lastChapter]?.page,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return visibleAccountHistory(stored, context, { ...options, limit: options.limit ?? 12 });
  } catch {
    return [];
  }
}
// Presence only: this never returns metadata or authorizes an unknown snapshot.
export function hasStoredNativeReadingHistory() {
  try {
    const prefix = statePrefix();
    return Object.keys(localStorage).some((key) => {
      if (
        !key.startsWith(prefix) ||
        parseMediaReference(key.slice(prefix.length))?.kind !== 'extension-manga'
      )
        return false;
      const item = getReadingState(key.slice(prefix.length));
      return !!(item.lastChapter && item.chapters[item.lastChapter]?.page);
    });
  } catch {
    return false;
  }
}

// Cloud results are applied only to the account that started the request.
export function mergeReaderMarkers(owner, id, chapters, acknowledged = null) {
  if (!owner || owner !== account) return;
  const state = getReadingState(id);
  const next = {
    ...state,
    chapters: { ...state.chapters },
    markerPending: { ...state.markerPending },
  };
  for (const [chapterId, remote] of Object.entries(chapters || {})) {
    const local = { ...next.chapters[chapterId] };
    for (const field of ['bookmark', 'read']) {
      const at = field + 'At';
      if ((remote[at] || 0) >= (local[at] || 0) && remote[at]) {
        local[field] = remote[field];
        local[at] = remote[at];
      }
    }
    next.chapters[chapterId] = local;
  }
  if (acknowledged) {
    const { chapterId, field, at } = acknowledged;
    const pending = { ...next.markerPending[chapterId] };
    if (pending[field]?.at === at) delete pending[field];
    if (Object.keys(pending).length) next.markerPending[chapterId] = pending;
    else delete next.markerPending[chapterId];
  }
  localStorage.setItem(statePrefix() + id, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(READER_EVENT, { detail: { id, cloud: true } }));
}
export function prepareReaderMarkers(owner, id) {
  if (!owner || owner !== account) return {};
  const state = getReadingState(id);
  // Preserve the old save time so migrating an older device cannot replace a newer cloud edit.
  const at = Math.max(1, Math.min(Number(state.updatedAt) || 1, Date.now()));
  let changed = false;
  state.markerPending = { ...state.markerPending };
  for (const [chapterId, chapter] of Object.entries(state.chapters)) {
    const pending = { ...state.markerPending[chapterId] };
    for (const field of ['bookmark', 'read']) {
      if (Object.hasOwn(chapter, field) && !chapter[field + 'At']) {
        pending[field] = { value: chapter[field], at };
        chapter[field + 'At'] = at;
        changed = true;
      }
    }
    if (Object.keys(pending).length) state.markerPending[chapterId] = pending;
  }
  if (changed) localStorage.setItem(statePrefix() + id, JSON.stringify(state));
  return state.markerPending;
}
