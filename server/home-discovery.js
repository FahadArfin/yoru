import { normalizeHomeAnime, providerJson } from './home-core.js';

const HOUR = 3600000;
const seasons = ['winter', 'spring', 'summer', 'fall'];
export function popularityPeriod(value, now = Date.now()) {
  const date = new Date(now);
  if (value === 'year') {
    const year = date.getUTCFullYear() - 1;
    return { period: 'year', year, label: `${year} releases` };
  }
  if (value === 'month') {
    const previous = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
    return {
      period: 'month',
      year: previous.getUTCFullYear(),
      month: previous.getUTCMonth(),
      season: seasons[Math.floor(previous.getUTCMonth() / 3)],
      label: `${previous.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} releases`,
    };
  }
  return { period: 'all', label: 'All-time favorites' };
}

export async function getPopularAnime(input = {}, options = {}) {
  const {
    now = Date.now(),
    token = '',
    load = async () => null,
    save = async () => {},
    claim = async () => true,
    fetchImpl = fetch,
  } = options;
  const period = popularityPeriod(input.period, now);
  const key = `discovery:v1:popular:${period.period}:${period.year || ''}:${period.month ?? ''}`;
  const saved = await load(key).catch(() => null);
  const response = (value, state, fetchedAt) => ({
    mode: 'popular',
    period: period.period,
    items: value || [],
    state,
    caption: period.label,
    source: 'AnimeSchedule',
    sourceUrl: 'https://animeschedule.net/',
    updatedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
  });
  if (saved && now - saved.fetchedAt < 6 * HOUR)
    return response(saved.value, 'ready', saved.fetchedAt);
  const claimed = token.trim() && (await claim(key, now).catch(() => false));
  if (token.trim() && !claimed && !saved) return response([], 'pending');
  if (claimed) {
    try {
      const params = new URLSearchParams({
        st: 'popularity',
        'airing-statuses-exclude': 'upcoming',
      });
      if (period.year) params.set('years', String(period.year));
      // The provider supports seasons, not a documented exact-month filter.
      // Walk the popularity-ordered season until we have 18 matching premieres.
      if (period.season) params.set('seasons', period.season);
      const signal = AbortSignal.timeout(12000);
      const items = [];
      const seen = new Set();
      for (let page = 1; page <= 20; page++) {
        params.set('page', String(page));
        const data = await fetchImpl(`https://animeschedule.net/api/v3/anime?${params}`, {
          headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
          signal,
          redirect: 'manual',
        }).then(providerJson);
        if (!Array.isArray(data.anime) || !Number.isFinite(data.totalAmount))
          throw Error('Invalid popularity response');
        for (const raw of data.anime) {
          const date = new Date(raw.premier);
          if (
            !Number.isFinite(date.getTime()) ||
            date.getUTCFullYear() < 1900 ||
            date.getTime() > now
          )
            continue;
          if (period.year && date.getUTCFullYear() !== period.year) continue;
          if (period.month !== undefined && date.getUTCMonth() !== period.month) continue;
          const media = normalizeHomeAnime(raw);
          if (!media || seen.has(media.id || media.route)) continue;
          seen.add(media.id || media.route);
          items.push({ ...media, episodes: Number(raw.episodes) || null, startDate: raw.premier });
        }
        if (items.length >= 18 || page * 18 >= data.totalAmount) {
          const value = items.slice(0, 18);
          await save(key, { value, fetchedAt: now }).catch(() => {});
          return response(value, 'ready', now);
        }
      }
      // Do not label a truncated scan as a complete monthly ranking.
      throw Error('Popularity scan incomplete');
    } catch {
      // Provider errors and credentials never reach the public response.
    }
  }
  return response(saved?.value, saved ? 'stale' : 'unavailable', saved?.fetchedAt);
}
