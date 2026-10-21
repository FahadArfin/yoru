import snapshot from './genre-snapshot.js';
import { loadSearch, saveSearch, isOffline, getRequestState } from './catalog-storage.js';

const KEY = 'genre-directory:manga:v1';
const DAY = 24 * 60 * 60 * 1000;
export function normalizeGenreDirectory(data) {
  return [
    ...new Map(
      (Array.isArray(data) ? data : [])
        .filter(
          (item) =>
            Number.isSafeInteger(item?.mal_id) &&
            item.mal_id > 0 &&
            typeof item.name === 'string' &&
            item.name.trim() &&
            item.name.length <= 60 &&
            Number.isSafeInteger(item.count) &&
            item.count >= 0 &&
            !/^(ecchi|erotica|hentai)$/i.test(item.name.trim()),
        )
        .map((item) => [
          item.mal_id,
          { id: item.mal_id, name: item.name.trim(), count: item.count },
        ]),
    ).values(),
  ].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

let saved = { items: normalizeGenreDirectory(snapshot.data), fetchedAt: snapshot.fetchedAt };
let retryAt = 0;
export async function getGenreDirectory() {
  const response = () => ({
    ...saved,
    countScope: 'combined-manga',
    source: 'MyAnimeList via Tenrai',
    stale: Date.now() - saved.fetchedAt >= DAY,
  });
  if (isOffline() || Date.now() - saved.fetchedAt < DAY || Date.now() < retryAt) return response();
  const pending = getRequestState().pending;
  if (pending.has(KEY)) return pending.get(KEY);
  const request = (async () => {
    try {
      const stored = await loadSearch(KEY);
      if (stored?.result?.items?.length && stored.result.fetchedAt > saved.fetchedAt)
        saved = stored.result;
      if (Date.now() - saved.fetchedAt < DAY) return response();
      const result = await fetch('https://api.tenrai.org/v1/genres/manga', {
        signal: AbortSignal.timeout(7000),
        headers: { Accept: 'application/json' },
      });
      if (!result.ok) throw new Error('Genre provider unavailable');
      const items = normalizeGenreDirectory((await result.json()).data);
      if (!items.length) throw new Error('Empty genre directory');
      saved = { items, fetchedAt: Date.now() };
      await saveSearch(KEY, saved, []).catch(() => {});
    } catch {
      retryAt = Date.now() + 60000;
    }
    return response();
  })().finally(() => pending.delete(KEY));
  pending.set(KEY, request);
  return request;
}
