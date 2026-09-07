import { apiError } from './validation.js';
const MAX_FAVORITES = 1000;
export function normalizePublicFavorites(payload) {
  if (!payload?.data || !Array.isArray(payload.data.anime) || !Array.isArray(payload.data.manga))
    throw apiError(
      502,
      'The public favorites provider returned an incomplete response. Try again later.',
    );
  if (payload.data.anime.length + payload.data.manga.length > MAX_FAVORITES)
    throw apiError(413, `Import up to ${MAX_FAVORITES} public favorites at a time.`);
  const entries = new Map();
  for (const kind of ['anime', 'manga']) {
    for (const item of payload.data[kind]) {
      if (
        !Number.isSafeInteger(item?.mal_id) ||
        item.mal_id < 1 ||
        item.mal_id > 999999999 ||
        typeof item.title !== 'string' ||
        !item.title.trim()
      )
        throw apiError(
          502,
          'The public favorites provider returned an invalid title. Your library has not changed.',
        );
      const mediaId = `mal-${kind}-${item.mal_id}`;
      entries.set(mediaId, {
        mediaId,
        malId: item.mal_id,
        title: item.title.trim().slice(0, 300),
        type: kind === 'anime' ? 'ANIME' : 'MANGA',
      });
    }
  }
  return [...entries.values()];
}
