export function animeRequest(mediaId, episode = 1, language = 'sub') {
  const match = /^mal-anime-([1-9]\d{0,8})$/.exec(String(mediaId));
  if (!match) throw new Error('Choose an anime title, not a manga or manhwa ID.');
  const number = Number(episode);
  if (!Number.isInteger(number) || number < 1 || number > 100000)
    throw new Error('Choose a whole episode number between 1 and 100000.');
  if (!['sub', 'dub'].includes(language)) throw new Error('Choose sub or dub.');
  return { mediaId, malId: Number(match[1]), episode: number, language };
}

export function embedSource(id, label, url, mapping) {
  return {
    id,
    label,
    url,
    kind: 'embed',
    mapping,
    availability: 'provider-managed',
    supportsSynchronizedPlayback: false,
    referrerPolicy: 'strict-origin-when-cross-origin',
  };
}

export function defaultAnimeSources(mediaId, episode = 1, language = 'sub') {
  const request = animeRequest(mediaId, episode, language);
  return [
    embedSource(
      'megaplay-mal',
      'MegaPlay',
      `https://megaplay.buzz/stream/mal/${request.malId}/${request.episode}/${request.language}`,
      'MyAnimeList ID',
    ),
  ];
}
