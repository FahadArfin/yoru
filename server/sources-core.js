import { animeRequest, defaultAnimeSources, embedSource } from '../shared/anime-sources.js';
import { getMedia } from './catalog-core.js';
import { isOffline } from './catalog-storage.js';
import { apiError } from './validation.js';

const cache = new Map();
const MAX_BYTES = 2 * 1024 * 1024;
async function providerJson(url, ttl, fetcher) {
  const saved = cache.get(url);
  if (saved && saved.expires > Date.now()) return saved.value;
  const response = await fetcher(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(4500),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES)
    throw new Error('Source directory unavailable.');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BYTES) throw new Error('Source directory response is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (cache.size >= 200) cache.delete(cache.keys().next().value);
  cache.set(url, { value, expires: Date.now() + ttl });
  return value;
}
export function clearSourceCache() {
  cache.clear();
}

function publicLink(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(
        url.hostname,
      ) ||
      !url.hostname.includes('.') ||
      url.hostname.endsWith('.local')
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function resolveAnimeSources(mediaId, options = {}, dependencies = {}) {
  let request;
  try {
    request = animeRequest(mediaId, options.episode, options.language);
  } catch (error) {
    throw apiError(400, error.message);
  }
  const media = await (dependencies.getMedia || getMedia)(mediaId);
  if (!media) throw apiError(404, 'This anime could not be found.');
  if (media.episodes && request.episode > media.episodes)
    throw apiError(400, `This title has ${media.episodes} episodes.`);
  const items = defaultAnimeSources(mediaId, request.episode, request.language);
  const warnings = [];
  const fetcher = dependencies.fetch || fetch;
  const offline = dependencies.offline ?? isOffline();
  let mapping, recent;
  if (!offline) {
    const results = await Promise.allSettled([
      providerJson(`https://api.malsync.moe/mal/anime/${request.malId}`, 3600000, fetcher),
      providerJson('https://anikotoapi.site/recent-anime?page=1&per_page=20', 300000, fetcher),
    ]);
    if (results[0].status === 'fulfilled') mapping = results[0].value;
    else
      warnings.push(
        'Extra provider matches are temporarily unavailable. The primary player is still available to try.',
      );
    if (results[1].status === 'fulfilled') recent = results[1].value;
  }
  const entries = [];
  if (mapping?.type === 'anime' && Number(mapping.id) === request.malId) {
    for (const [provider, records] of Object.entries(mapping.Sites || {})) {
      for (const entry of Object.values(records || {})) {
        if (
          !entry ||
          entry.type !== 'anime' ||
          (entry.malId && Number(entry.malId) !== request.malId)
        )
          continue;
        entries.push({ ...entry, provider });
      }
    }
    const aniIds = [
      ...new Set(
        entries
          .filter((x) => Number(x.malId) === request.malId)
          .map((x) => Number(x.aniId))
          .filter((x) => Number.isSafeInteger(x) && x > 0),
      ),
    ];
    if (aniIds.length === 1)
      items.push(
        embedSource(
          'megaplay-anilist',
          'MegaPlay · alternate match',
          `https://megaplay.buzz/stream/ani/${aniIds[0]}/${request.episode}/${request.language}`,
          'MALSync → AniList ID',
        ),
      );
  }
  // Only exact MAL IDs may bridge into the provider's separate catalog namespace.
  const recentRows = Array.isArray(recent?.data)
    ? recent.data
    : recent?.data?.anime || recent?.data?.items || [];
  const match =
    Array.isArray(recentRows) && recentRows.find((x) => x && Number(x.mal_id) === request.malId);
  if (match && /^[1-9]\d{0,8}$/.test(String(match.id))) {
    try {
      const series = await providerJson(
        `https://anikotoapi.site/series/${match.id}`,
        300000,
        fetcher,
      );
      if (Number(series.data?.anime?.mal_id) === request.malId) {
        const episode = Array.isArray(series.data?.episodes)
          ? series.data.episodes.find((x) => x && Number(x.number) === request.episode)
          : null;
        const link = episode?.embed_url?.[request.language];
        if (
          typeof link === 'string' &&
          /^https:\/\/megaplay\.buzz\/stream\/s-2\/[1-9]\d*\/(sub|dub)$/.test(link) &&
          link.endsWith(`/${request.language}`)
        ) {
          items.push(
            embedSource(
              'megaplay-episode',
              'MegaPlay · episode match',
              link,
              'Exact catalog episode',
            ),
          );
        }
      }
    } catch {
      /* ID-based embeds and other providers remain available. */
    }
  }
  const allowedProviders = new Set([
    'Crunchyroll',
    'Netflix',
    'Hulu',
    'Hidive',
    'animepahe',
    'KickAssAnime',
    'Anikoto',
    'allManga',
    'AllAnime',
  ]);
  for (const entry of entries) {
    const url = publicLink(entry.url);
    if (url && allowedProviders.has(entry.provider))
      items.push({
        id: sourceId('malsync', entry.provider, url),
        label: entry.provider,
        url,
        kind: 'external',
        mapping: 'MALSync exact title',
        availability: 'provider-managed',
        supportsSynchronizedPlayback: false,
      });
  }
  for (const link of media.externalLinks || []) {
    const url = publicLink(link.url);
    if (link.type === 'streaming' && url)
      items.push({
        id: sourceId('official', link.label, url),
        label: link.label,
        url,
        kind: 'external',
        mapping: 'Catalog provider link',
        availability: 'provider-managed',
        supportsSynchronizedPlayback: false,
      });
  }
  return {
    ...request,
    title: typeof media.title === 'string' ? media.title : media.title?.english,
    items: items.filter(
      (item, index) =>
        !items
          .slice(0, index)
          .some(
            (previous) =>
              previous.url === item.url ||
              (item.kind === 'external' &&
                previous.kind === 'external' &&
                previous.label.toLowerCase() === item.label.toLowerCase()),
          ),
    ),
    warnings,
    note: 'Providers control episode and language availability. Embedded players do not support synchronized room controls.',
  };
}

// Stable across upstream ordering changes; no provider URL is used as a DOM ID.
function sourceId(prefix, label, url) {
  let hash = 2166136261;
  for (const char of url) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${prefix}-${String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)}-${(hash >>> 0).toString(36)}`;
}
