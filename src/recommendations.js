import { coverOf, kindOf } from './api.js';

const genreKey = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function recommendationQuery(media, withGenre = true) {
  const query = new URLSearchParams({
    category: kindOf(media),
    sort: 'popular',
    limit: '24',
  });
  if (withGenre && media.genres?.[0]) query.set('genre', media.genres[0]);
  return `/api/catalog?${query}`;
}

export function relatedTitles(media, items = []) {
  const genres = new Set((media.genres || []).map(genreKey));
  const seen = new Set([String(media.id)]);
  return items
    .filter((item) => {
      if (
        !item.id ||
        seen.has(String(item.id)) ||
        kindOf(item) !== kindOf(media) ||
        item.isAdult ||
        item.imported ||
        coverOf(item) === '/icon.svg'
      )
        return false;
      seen.add(String(item.id));
      return true;
    })
    .map((item) => ({
      item,
      matches: new Set((item.genres || []).map(genreKey).filter((genre) => genres.has(genre))).size,
    }))
    .sort((a, b) => b.matches - a.matches)
    .map(({ item }) => item);
}
