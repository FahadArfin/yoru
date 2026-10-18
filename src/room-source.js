import { defaultAnimeSources } from '../shared/anime-sources';

// Only this documented URL mapping can safely follow an episode change.
export function sourceForUnit(mediaId, unit, source, previousUnit = unit) {
  const match = /^https:\/\/megaplay\.buzz\/stream\/mal\/(\d+)\/\d+\/(sub|dub)$/.exec(
    source?.url || '',
  );
  if (match && mediaId === `mal-anime-${match[1]}`)
    return defaultAnimeSources(mediaId, unit, match[2])[0];
  if (source?.url) return unit === previousUnit ? source : null;
  try {
    return defaultAnimeSources(mediaId, unit)[0];
  } catch {
    return null;
  }
}
