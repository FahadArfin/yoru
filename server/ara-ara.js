import { araTitles, isAraMedia } from '../shared/ara-ara.js';
import { getMedia } from './catalog-core.js';

export async function getAraCatalog(media = getMedia) {
  const resolved = await Promise.all(
    araTitles.map(async (entry) => {
      const item = await media(entry.id).catch(() => null);
      return isAraMedia(item) ? { ...item, editorialNote: entry.note } : null;
    }),
  );
  return {
    items: resolved.filter(Boolean),
    curated: true,
    unavailable: resolved.filter((x) => !x).length,
  };
}

const normalized = (text) =>
  String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
// No fuzzy franchise matching: a sequel can have a different rating and membership.
export async function scopeAraSchedule(result, category = 'ANIME', catalog = getAraCatalog) {
  const { items } = await catalog();
  const titles = items.filter((item) => item.category === category);
  return {
    ...result,
    items: (result.items || []).flatMap((release) => {
      const media = release.mediaId
        ? titles.find((item) => item.id === release.mediaId)
        : titles.find((item) =>
            [item.title, item.titleEnglish, item.titleRomaji, item.titleJapanese]
              .filter(Boolean)
              .some((title) => normalized(title) === normalized(release.title)),
          );
      return media ? [{ ...release, mediaId: media.id }] : [];
    }),
    collection: 'ara-ara',
  };
}
