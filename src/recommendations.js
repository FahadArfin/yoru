import { coverOf, kindOf } from './api.js';
import { assertMediaEligible, assertSourceEligible } from '../shared/reading-eligibility.js';

const genreKey = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace('sciencefiction', 'scifi');

// Specific genres describe taste better than broad labels such as Drama or Action.
const weights = {
  romance: 6,
  boyslove: 6,
  girlslove: 6,
  sports: 5,
  gourmet: 5,
  horror: 5,
  mystery: 4,
  suspense: 4,
  scifi: 4,
  sliceoflife: 4,
  fantasy: 3,
  comedy: 2,
  action: 2,
  adventure: 2,
  drama: 1,
};
const weight = (key) => weights[key] || 3;
export function recommendationGenre(media) {
  return (
    [...(media.genres || [])].sort((a, b) => weight(genreKey(b)) - weight(genreKey(a)))[0] || ''
  );
}

export function recommendationQuery(media) {
  const genre = recommendationGenre(media);
  if (!genre) return null;
  const query = new URLSearchParams({
    category: kindOf(media),
    sort: 'popular',
    limit: '48',
    genre,
  });
  return `/api/catalog?${query}`;
}

export function sharedRecommendationGenres(media, item) {
  const genres = new Set((media.genres || []).map(genreKey));
  return [...new Set(item.genres || [])]
    .filter((genre) => genres.has(genreKey(genre)))
    .sort((a, b) => weight(genreKey(b)) - weight(genreKey(a)));
}

export function relatedTitles(
  media,
  items = [],
  { destination = 'yoru', overrides = {}, integrationMode = 'all' } = {},
) {
  const genres = new Set((media.genres || []).map(genreKey));
  const anchor = genreKey(recommendationGenre(media));
  if (!anchor) return [];
  const seen = new Set([String(media.id)]);
  return items
    .filter((item) => {
      try {
        const context = { destination, overrides, integrationMode, extensionsEnabled: true };
        assertMediaEligible(item, context);
        if (item.sourceRef) assertSourceEligible(item.sourceRef, context, { discovery: true });
        else if (kindOf(item) !== 'ANIME' && integrationMode === 'extensions') return false;
      } catch {
        return false;
      }
      if (
        !item.id ||
        seen.has(String(item.id)) ||
        kindOf(item) !== kindOf(media) ||
        item.imported ||
        coverOf(item) === '/icon.svg' ||
        !(item.genres || []).some((genre) => genreKey(genre) === anchor)
      )
        return false;
      seen.add(String(item.id));
      return true;
    })
    .map((item) => {
      const tags = new Set((item.genres || []).map(genreKey));
      const shared = [...tags]
        .filter((tag) => genres.has(tag))
        .reduce((sum, tag) => sum + weight(tag), 0);
      const union = [...new Set([...genres, ...tags])].reduce((sum, tag) => sum + weight(tag), 0);
      // Favor similar tone over a popular title with one incidental matching tag.
      const mismatch = ['horror', 'gore', 'psychological'].filter(
        (tag) => tags.has(tag) && !genres.has(tag),
      ).length;
      return { item, similarity: shared / union - mismatch * 0.12 };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .map(({ item }) => item);
}
