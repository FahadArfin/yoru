import { apiError } from './validation.js';

const number = (value) =>
  Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 100000
    ? Number(value)
    : null;
const text = (value) =>
  typeof value === 'string' ? value.replace(/<[^>]*>/g, '').slice(0, 500) : '';
function image(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export function normalizeEpisodes(data, page) {
  if (!Array.isArray(data?.data)) throw Error('Episode metadata unavailable');
  const items = [
    ...new Map(
      data.data
        .slice(0, 100)
        .map((raw) => {
          const episode = number(raw.mal_id);
          if (!episode) return [null, null];
          return [
            episode,
            {
              number: episode,
              title: text(raw.title) || `Episode ${episode}`,
              description: text(raw.synopsis),
              aired: Number.isFinite(Date.parse(raw.aired))
                ? new Date(raw.aired).toISOString()
                : null,
              image: image(raw.images?.jpg?.image_url || raw.images?.webp?.image_url),
              filler: raw.filler === true,
              recap: raw.recap === true,
            },
          ];
        })
        .filter(([key]) => key),
    ).values(),
  ].sort((a, b) => a.number - b.number);
  return {
    items,
    page,
    pages: Math.max(page, Math.min(1000, number(data.pagination?.last_visible_page) || page)),
    hasNext: data.pagination?.has_next_page === true,
  };
}

export async function getAnimeEpisodes(id, input = {}, options = {}) {
  const match = /^mal-anime-([1-9]\d{0,8})$/.exec(id || '');
  if (!match) throw apiError(400, 'Choose an anime title.');
  const page = Number(input.page || 1);
  if (!Number.isInteger(page) || page < 1 || page > 1000)
    throw apiError(400, 'Invalid episode page.');
  const {
    media: getMedia,
    request,
    load = async () => null,
    save = async () => {},
    claim = async () => true,
    now = Date.now(),
    offline = false,
  } = options;
  const media = await getMedia(id);
  if (!media || media.id !== id || media.category !== 'ANIME' || media.isAdult)
    throw apiError(404, 'This anime is unavailable.');
  const finished = /^(finished airing|finished)$/i.test(media.status || '');
  const upcoming = /^(not yet aired|upcoming|tba)$/i.test(media.status || '');
  const total = number(media.episodes);
  let partial = false;
  async function getPage(index) {
    const key = `anime-episodes:v2:${match[1]}:${index}`;
    const cached = await load(key).catch(() => null);
    if (cached?.value && now - cached.fetchedAt < 20 * 60000) return cached.value;
    if (!offline && (await claim(key, now).catch(() => false))) {
      try {
        const value = normalizeEpisodes(await request(Number(match[1]), index), index);
        await save(key, { value, fetchedAt: now }).catch(() => {});
        return value;
      } catch {
        /* Retain last-known metadata when the provider is unavailable. */
      }
    }
    partial = true;
    return (
      cached?.value || {
        items: [],
        page: index,
        pages: Math.ceil((total || 100) / 100),
        hasNext: Boolean(total && index * 100 < total),
      }
    );
  }
  const first = await getPage(input.latest === '1' ? 1 : page);
  let latest = null;
  if (input.latest === '1' && !upcoming) {
    // Bound work even for series with thousands of episodes; never crawl the catalog.
    const candidates = [...first.items];
    for (let index = first.pages; index > Math.max(1, first.pages - 3); index--) {
      const tail = index === 1 ? first : await getPage(index);
      candidates.push(...tail.items);
      if (tail.items.some((item) => item.aired && Date.parse(item.aired) <= now)) break;
    }
    latest =
      candidates
        .filter((item) => item.aired && Date.parse(item.aired) <= now)
        .sort((a, b) => b.number - a.number)[0]?.number || null;
    if (!latest && finished && total) latest = total;
  }
  return {
    mediaId: id,
    ...first,
    total,
    latest,
    upcoming,
    partial,
    source: 'MyAnimeList via Tenrai',
  };
}
