import { normalizeHomeAnime, providerJson } from './home-core.js';

// Count watched libraries, never infer video plays from page visits or popularity.
export const mostViewedQuery = `SELECT media_id, COUNT(*) AS viewers FROM library
  WHERE progress > 0 AND media_id GLOB 'mal-anime-[0-9]*'
  GROUP BY media_id ORDER BY viewers DESC, media_id ASC LIMIT 4`;

export async function getHomeSidebar(options = {}) {
  const {
    now = Date.now(),
    token = '',
    load = async () => null,
    save = async () => {},
    claim = async () => true,
    fetchImpl = fetch,
    viewed = async () => [],
    media = async () => null,
  } = options;
  const key = 'home:v1:upcoming';
  const saved = await load(key).catch(() => null);
  let upcoming = saved?.value || [],
    stale = !saved || now - saved.fetchedAt >= 6 * 3600000;
  if (stale && token.trim() && (await claim(key, now).catch(() => false))) {
    try {
      const response = await fetchImpl(
        'https://animeschedule.net/api/v3/anime?airing-statuses=upcoming&st=popularity',
        {
          headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
          redirect: 'manual',
          signal: AbortSignal.timeout(6000),
        },
      );
      const data = await providerJson(response);
      if (!Array.isArray(data.anime) || !data.anime.length)
        throw Error('Invalid upcoming response');
      const entries = data.anime.map(normalizeHomeAnime).filter(Boolean).slice(0, 8);
      if (!entries.length) throw Error('Invalid upcoming entries');
      upcoming = entries;
      await save(key, { value: upcoming, fetchedAt: now }).catch(() => {});
      stale = false;
    } catch {
      /* Keep the last successful feed. */
    }
  }
  const rows = await viewed();
  const mostViewed = (
    await Promise.all(
      rows.slice(0, 4).map(async (row) => {
        const item = await media(row.media_id).catch(() => null);
        return item ? { ...item, viewers: Number(row.viewers) } : null;
      }),
    )
  ).filter(Boolean);
  return {
    upcoming,
    mostViewed,
    stale,
    ranking: 'Yoru libraries with watched episodes',
    source: 'AnimeSchedule.net',
  };
}
