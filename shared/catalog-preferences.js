// Initial site defaults captured from the owner's Settings selections on 2026-10-18.
// Provider names deliberately cover every language edition, including newly installed ones.
export const catalogDefaults = Object.freeze(
  Object.fromEntries([
    ...[
      'Cubari',
      'Frieren Online',
      'MangaDex',
      'Mangakakalot',
      'Manhwa Comics',
      'Webcomics',
      'Webtoons.com',
      'Weeb Central',
    ].map((name) => [name, Object.freeze({ yoru: true, 'ara-ara': false })]),
    ...[
      '3Hentai',
      'AllPornComics.co',
      'Hennojin',
      'HentaiHand',
      'HentaiXDickgirl',
      'HentaiXYuri',
      'Luscious',
      'Manhwa18.cc',
      'ManhwaClub.net',
      'NHentai.to',
      'NHentai.xxx',
      'NineHentai',
    ].map((name) => [name, Object.freeze({ yoru: false, 'ara-ara': true })]),
    ['Aunt Manhwa', Object.freeze({ yoru: true, 'ara-ara': true })],
  ]),
);
// Exact installed package families, verified against the retained source inventory.
// Keep package identities in bindings/storage; Settings continues using these labels.
const packageFamilies = Object.freeze(
  Object.fromEntries(
    [
      ['all.allporncomicsco', 'AllPornComics.co'],
      ['all.cubari', 'Cubari'],
      ['all.hennojin', 'Hennojin'],
      ['all.hentai3', '3Hentai'],
      ['all.hentaihand', 'HentaiHand'],
      ['all.luscious', 'Luscious'],
      ['all.mangadex', 'MangaDex'],
      ['all.manhwa18cc', 'Manhwa18.cc'],
      ['all.manhwaclubnet', 'ManhwaClub.net'],
      ['all.nhentaito', 'NHentai.to'],
      ['all.nhentaixxx', 'NHentai.xxx'],
      ['all.webcomics', 'Webcomics'],
      ['all.webtoons', 'Webtoons.com'],
      ['en.auntmanhwa', 'Aunt Manhwa'],
      ['en.frierenonline', 'Frieren Online'],
      ['en.hentaixdickgirl', 'HentaiXDickgirl'],
      ['en.hentaixyuri', 'HentaiXYuri'],
      ['en.mangakakalot', 'Mangakakalot'],
      ['en.manhwacomics', 'Manhwa Comics'],
      ['en.ninehentai', 'NineHentai'],
      ['en.weebcentral', 'Weeb Central'],
    ].map(([suffix, name]) => [`eu.kanade.tachiyomi.extension.${suffix}`, name]),
  ),
);
const familyPackages = Object.freeze(
  Object.fromEntries(Object.entries(packageFamilies).map(([pkg, name]) => [name, pkg])),
);
export const catalogProviderFamily = (provider) =>
  Object.hasOwn(packageFamilies, provider) ? packageFamilies[provider] : provider;

// Explicit provider coverage, independent of a visitor's enabled memberships.
// Unknown providers are not advertised in Manhwa until their coverage is known.
const manhwaProviders = new Set([
  'Manhwa18.cc',
  'ManhwaClub.net',
  'Aunt Manhwa',
  'Manhwa Comics',
  'MangaDex',
  'Mangakakalot',
  'Weeb Central',
  'Webcomics',
  'Webtoons.com',
]);
export const sourceSupportsReadingCategory = (source, category) =>
  category !== 'manhwa' ||
  manhwaProviders.has(catalogProviderFamily(source?.providerKey || readingProvider(source?.id)));

// Source language and an adult rating do not establish a title's format/origin.
export const readingTitleCategory = (metadata) =>
  metadata.category === 'MANHWA' ||
  (Array.isArray(metadata.genres) &&
    metadata.genres.some(
      (genre) => typeof genre === 'string' && genre.trim().toLowerCase() === 'manhwa',
    ))
    ? 'MANHWA'
    : 'MANGA';
export function catalogEnabled(provider, destination = 'yoru', overrides = {}) {
  const family = Object.hasOwn(packageFamilies, provider) ? packageFamilies[provider] : provider;
  const aliases = [family, Object.hasOwn(familyPackages, family) ? familyPackages[family] : null];
  const values = aliases
    .filter(Boolean)
    .map((alias) =>
      Object.hasOwn(overrides, alias) ? overrides[alias]?.[destination] : undefined,
    );
  if (values.includes(false)) return false;
  if (values.includes(true)) return true;
  return catalogDefaults[family]?.[destination] === true;
}
export const readingProvider = (source) =>
  ({ mangadex: 'MangaDex', weebcentral: 'Weeb Central' })[source];
export const filterReadingSources = (sources, destination, overrides) =>
  sources.filter((source) =>
    catalogEnabled(
      source.sourceRef?.providerKey ??
        source.providerKey ??
        readingProvider(source.id) ??
        source.name,
      destination,
      overrides,
    ),
  );
