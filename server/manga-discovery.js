import { normalizeKitsu } from './catalog-core.js';
import { popularityPeriod } from './home-discovery.js';

export async function getMangaDiscovery(input = {}, options = {}) {
  const {
    now = Date.now(),
    offline = false,
    load = async () => null,
    save = async () => {},
    claim = async () => true,
    fetchImpl = fetch,
    remember = (items) => items,
  } = options;
  const mode = input.mode === 'new' ? 'new' : 'popular';
  const period = popularityPeriod(mode === 'popular' ? input.period : 'all', now);
  const key = `manga-discovery:v1:${mode}:${period.period}:${period.year || ''}:${period.month ?? ''}`;
  const saved = await load(key).catch(() => null);
  const response = (items, state, fetchedAt) => ({
    mode,
    period: period.period,
    items: items || [],
    state,
    source: 'Kitsu',
    caption: mode === 'new' ? 'Recently published manga series' : period.label,
    updatedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
  });
  if (saved && now - saved.fetchedAt < 6 * 3600000)
    return response(saved.value, 'ready', saved.fetchedAt);
  if (offline) return response(saved?.value, saved ? 'stale' : 'unavailable', saved?.fetchedAt);
  if (!(await claim(key, now).catch(() => false)))
    return response(saved?.value, saved ? 'stale' : 'pending', saved?.fetchedAt);
  try {
    const monthly = period.month !== undefined;
    const params = new URLSearchParams({
      include: 'mappings,categories',
      'page[limit]': '20',
      'filter[subtype]': 'manga',
      'filter[status]': 'current,finished',
      sort: mode === 'new' || monthly ? '-startDate' : '-userCount',
    });
    if (period.year) params.set('filter[year]', String(period.year));
    const signal = AbortSignal.timeout(12000);
    const items = new Map();
    for (let page = 0; page < 20; page++) {
      params.set('page[offset]', String(page * 20));
      const result = await fetchImpl(`https://kitsu.io/api/edge/manga?${params}`, {
        signal,
        headers: { Accept: 'application/vnd.api+json' },
        redirect: 'manual',
      });
      if (!result.ok) throw Error('Manga provider unavailable');
      const data = await result.json();
      if (!Array.isArray(data.data)) throw Error('Invalid manga response');
      let passedMonth = false;
      for (const raw of data.data) {
        const date = Date.parse(raw.attributes?.startDate);
        if (!Number.isFinite(date) || date > now || date < Date.UTC(1900, 0, 1)) continue;
        if (monthly && date < Date.UTC(period.year, period.month, 1)) passedMonth = true;
        if (period.year && new Date(date).getUTCFullYear() !== period.year) continue;
        if (monthly && new Date(date).getUTCMonth() !== period.month) continue;
        const media = normalizeKitsu(raw, data.included || []);
        if (!media || media.category !== 'MANGA' || media.isAdult) continue;
        items.set(media.id, {
          ...media,
          detailed: false,
          banner: raw.attributes.coverImage?.original || '',
          bannerImage: raw.attributes.coverImage?.original || '',
          cover: raw.attributes.posterImage?.large || raw.attributes.posterImage?.original || '',
        });
      }
      if (!data.links?.next || passedMonth || (!monthly && items.size >= 18)) {
        const value = [...items.values()];
        if (mode === 'popular') value.sort((a, b) => (b.members || 0) - (a.members || 0));
        const selected = value.slice(0, 18);
        remember(selected);
        await save(key, { value: selected, fetchedAt: now }).catch(() => {});
        return response(selected, 'ready', now);
      }
    }
    throw Error('Manga discovery scan incomplete');
  } catch {
    return response(saved?.value, saved ? 'stale' : 'unavailable', saved?.fetchedAt);
  }
}
