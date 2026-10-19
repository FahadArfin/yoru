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
export function catalogEnabled(provider, destination = 'yoru', overrides = {}) {
  const value = Object.hasOwn(overrides, provider) ? overrides[provider]?.[destination] : undefined;
  return typeof value === 'boolean' ? value : catalogDefaults[provider]?.[destination] === true;
}
export const readingProvider = (source) =>
  ({ mangadex: 'MangaDex', weebcentral: 'Weeb Central' })[source];
export const filterReadingSources = (sources, destination, overrides) =>
  sources.filter((source) =>
    catalogEnabled(readingProvider(source.id) || source.name, destination, overrides),
  );
