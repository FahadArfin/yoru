export const animationCategories = {
  japanese: 'Japanese',
  korean: 'Korean',
  chinese: 'Chinese',
  cartoons: 'Cartoons',
  all: 'All',
};

// Exact AnimeSchedule routes, deliberately independent of translated titles and
// release language. This is a reviewed family-series list, not an age-rating
// heuristic: shounen, G/PG ratings, and cute artwork do not imply children's TV.
const familyRoutes = new Set([
  'beyblade-x',
  'bonobono-2016',
  'chibi-maruko-chan-1995',
  'doraemon-2005',
  'meitantei-precure',
  'nezumi-kun-no-chokki-tv-2nd-season',
  'ninjala',
  'onegai-aipri',
  'petitcure-precure-fairies-4th-season',
  'pokemon-2023',
  'sazae-san',
  'shimajirou-no-wow',
  'sore-ike-anpanman',
]);

// Country of animation production, not the source comic's country. Lookism is
// produced by Korea's Studio Mir; Japanese webtoon adaptations stay Japanese.
// https://media.netflix.com/en/only-on-netflix/81177634
const koreanRoutes = new Set(['gaiken-shijou-shugi']);

export function scheduleCategory(item) {
  if (familyRoutes.has(item.route)) return 'cartoons';
  if (koreanRoutes.has(item.route)) return 'korean';
  if (item.donghua === true) return 'chinese';
  // AnimeSchedule exposes donghua, but not universal origin/audience metadata.
  // Japanese is the feed's default anime bucket, not independently verified
  // country metadata for every title. All always retains the full source feed.
  return 'japanese';
}
