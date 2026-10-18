import { apiError } from './validation.js';

const text = (value) =>
  typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, '')
        .trim()
        .slice(0, 180)
    : '';
function portrait(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
function person(raw) {
  const id = Number(raw?.mal_id);
  if (!Number.isSafeInteger(id) || id < 1 || !text(raw?.name)) return null;
  return {
    id,
    name: text(raw.name),
    image: portrait(raw.images?.jpg?.image_url || raw.images?.webp?.image_url),
  };
}
export function normalizeCast(data) {
  if (!Array.isArray(data?.data)) throw Error('Cast unavailable');
  const seen = new Set();
  return data.data
    .slice(0, 1000)
    .flatMap((raw) => {
      const character = person(raw?.character);
      if (!character || seen.has(character.id)) return [];
      seen.add(character.id);
      const actors = new Map();
      for (const credit of Array.isArray(raw.voice_actors) ? raw.voice_actors.slice(0, 100) : []) {
        const actor = person(credit?.person),
          language = text(credit?.language);
        if (actor && language) actors.set(`${actor.id}:${language}`, { ...actor, language });
      }
      return [{ ...character, role: text(raw.role) || 'Character', actors: [...actors.values()] }];
    })
    .sort((a, b) => Number(b.role === 'Main') - Number(a.role === 'Main'));
}
export async function getAnimeCast(id, options = {}) {
  const match = /^mal-anime-([1-9]\d{0,8})$/.exec(id || '');
  if (!match) throw apiError(400, 'Choose an anime title.');
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
  const key = `anime-cast:v1:${match[1]}`;
  const cached = await load(key).catch(() => null);
  let items = cached?.value?.items || [],
    partial = false;
  if (!cached?.value || now - cached.fetchedAt >= 24 * 60 * 60000) {
    partial = true;
    if (!offline && (await claim(key, now).catch(() => false))) {
      try {
        items = normalizeCast(await request(Number(match[1])));
        partial = false;
        await save(key, { value: { items }, fetchedAt: now }).catch(() => {});
      } catch {
        /* Preserve verified credits during provider outages. */
      }
    }
  }
  return { mediaId: id, items, partial, source: 'MyAnimeList via Tenrai' };
}
