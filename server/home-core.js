import { homeArtwork } from './home-artwork.js';
import { getSchedule } from './schedule-core.js';
import { DAY_MS, weekStart } from '../shared/schedule.js';
const API = 'https://animeschedule.net/api/v3';
const text = (value) =>
  typeof value === 'string' ? value.replace(/<[^>]*>/g, '').slice(0, 2000) : '';
const image = (route) =>
  typeof route === 'string' && /^[a-zA-Z0-9_./-]+$/.test(route) && !route.includes('..')
    ? `https://img.animeschedule.net/production/assets/public/img/${route}`
    : '/icon.svg';
export function normalizeHomeAnime(raw) {
  if (!raw || !/^[a-z0-9][a-z0-9-]{0,999}$/.test(raw.route || '')) return null;
  let malId = null;
  try {
    const value = raw.websites?.mal || '';
    const url = new URL(value.startsWith('https://') ? value : `https://${value}`);
    const match = url.pathname.match(/^\/anime\/([1-9]\d*)(?:\/|$)/);
    if (
      url.hostname === 'myanimelist.net' &&
      !url.username &&
      !url.password &&
      match &&
      Number.isSafeInteger(Number(match[1]))
    )
      malId = Number(match[1]);
  } catch {
    /* Missing identity stays external. */
  }
  return {
    id: malId ? `mal-anime-${malId}` : null,
    malId,
    route: raw.route,
    title: text(raw.names?.english || raw.title || raw.names?.romaji) || 'Untitled',
    cover: image(raw.imageVersionRoute),
    type: 'ANIME',
    category: 'ANIME',
    description: text(raw.description),
    genres: (raw.genres || []).map((x) => text(x.name)).slice(0, 5),
    format: text(raw.mediaTypes?.[0]?.name) || 'Anime',
    year: raw.year || null,
    trackedCount: Number(raw.stats?.trackedCount) || 0,
    score: Number(raw.stats?.averageScore) > 0 ? Number(raw.stats.averageScore) / 10 : null,
    source: 'AnimeSchedule.net',
    providerUrl: `${API.replace('/api/v3', '')}/anime/${raw.route}`,
  };
}
export function releasedEpisodes(items, language, now) {
  const seen = new Set();
  return items
    .filter(
      (x) =>
        x.airType === language &&
        !x.delayed &&
        x.episode > 0 &&
        Date.parse(x.airingAt) <= now &&
        Date.parse(x.airingAt) >= now - 7 * DAY_MS,
    )
    .sort((a, b) => Date.parse(b.airingAt) - Date.parse(a.airingAt))
    .filter((x) => {
      if (seen.has(x.route)) return false;
      seen.add(x.route);
      return true;
    })
    .slice(0, 18);
}
export async function providerJson(response) {
  if (!response.ok) throw Error('Provider unavailable');
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw Error('Provider response too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function pooled(items, run) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, items.length) }, async () => {
      while (index < items.length) {
        const item = items[index++];
        await run(item);
      }
    }),
  );
}
export async function getHome(input = {}, options = {}) {
  const {
    now = Date.now(),
    token = '',
    load = async () => null,
    save = async () => {},
    claim = async () => true,
    fetchImpl = fetch,
    schedule = getSchedule,
  } = options;
  const language = input.language === 'dub' ? 'dub' : 'sub';
  const calendar = await schedule({}, options);
  let stale = calendar.state !== 'ready';
  const request = (path) =>
    fetchImpl(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
      redirect: 'manual',
    }).then(providerJson);
  async function cached(key, ttl, run) {
    const saved = await load(key).catch(() => null);
    if (saved && now - saved.fetchedAt < ttl) return saved.value;
    if (token.trim() && (await claim(key, now).catch(() => false))) {
      try {
        const value = await run();
        await save(key, { value, fetchedAt: now }).catch(() => {});
        return value;
      } catch {
        stale = true;
      }
    } else stale = true;
    return saved?.value ?? null;
  }
  const popular =
    (await cached('home:v1:popular', 6 * 3600000, async () => {
      const data = await request('/anime?airing-statuses=ongoing&st=popularity');
      if (!Array.isArray(data.anime) || !data.anime.length)
        throw Error('Invalid popularity response');
      const items = data.anime.map(normalizeHomeAnime).filter(Boolean);
      if (!items.length) throw Error('Invalid popularity entries');
      return items;
    })) || [];
  const start = Date.parse(`${weekStart(new Date(now).toISOString().slice(0, 10))}T00:00:00Z`);
  const weeklyRoutes = new Set(
    calendar.items
      .filter(
        (x) =>
          !x.delayed &&
          Date.parse(x.airingAt) >= start &&
          Date.parse(x.airingAt) < start + 7 * DAY_MS,
      )
      .map((x) => x.route),
  );
  const hot = popular
    .filter((x) => x.id && weeklyRoutes.has(x.route))
    .sort((a, b) => b.trackedCount - a.trackedCount)
    .slice(0, 6)
    .map((x) => ({ ...x }));
  const releases = releasedEpisodes(calendar.items, language, now).map((x) => ({ ...x }));
  const metadata = new Map(popular.map((x) => [x.route, x]));
  await pooled(
    releases.filter((x) => !metadata.has(x.route)),
    async (entry) => {
      const media = await cached(`home:v1:anime:${entry.route}`, 7 * DAY_MS, async () => {
        const data = await request(`/anime/${entry.route}`);
        if (data.route !== entry.route) throw Error('Anime identity mismatch');
        const normalized = normalizeHomeAnime(data);
        if (!normalized) throw Error('Invalid anime');
        return normalized;
      });
      if (media) metadata.set(entry.route, media);
    },
  );
  for (const entry of releases) entry.media = metadata.get(entry.route) || null;
  if (options.artwork)
    await pooled(hot, async (media) => {
      const known = homeArtwork[media.id] || options.artwork.find((x) => x.id === media.id);
      if (known?.banner) {
        media.banner = known.banner;
        if (known.logo) media.logo = known.logo;
        return;
      }
      const artwork = await cached(`home:v1:art:${media.malId}`, 7 * DAY_MS, async () => {
        const params = new URLSearchParams({
          'filter[externalSite]': 'myanimelist/anime',
          'filter[externalId]': String(media.malId),
          include: 'item',
        });
        const data = await fetchImpl(`https://kitsu.io/api/edge/mappings?${params}`, {
          headers: { Accept: 'application/vnd.api+json' },
          signal: AbortSignal.timeout(4000),
          redirect: 'manual',
        }).then(providerJson);
        const mapping = data.data?.find(
          (x) =>
            x.attributes?.externalSite === 'myanimelist/anime' &&
            String(x.attributes?.externalId) === String(media.malId),
        );
        const identity = mapping?.relationships?.item?.data;
        const item = data.included?.find(
          (x) => x.type === 'anime' && x.id === identity?.id && identity?.type === 'anime',
        );
        const url = item?.attributes?.coverImage?.large || item?.attributes?.coverImage?.original;
        return typeof url === 'string' && /^https:\/\//.test(url) ? url : null;
      });
      if (artwork) media.banner = artwork;
    });
  return {
    hot,
    releases,
    language,
    stale,
    state: calendar.state,
    updatedAt: calendar.updatedAt,
    ranking: 'AnimeSchedule popularity among anime airing this week',
    source: 'AnimeSchedule.net',
  };
}
