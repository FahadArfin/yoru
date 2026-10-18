// Editorial membership, not a replacement for provider content ratings.
// Add only reviewed, non-explicit works. See docs/ARA_ARA.md.
export const araTitles = [
  { id: 'mal-anime-37521', category: 'ANIME', note: 'War, revenge and the cost of violence.' },
  {
    id: 'mal-anime-16498',
    category: 'ANIME',
    note: 'Survival, military conflict and moral choices.',
  },
  { id: 'mal-anime-40748', category: 'ANIME', note: 'Supernatural horror and intense battles.' },
  { id: 'mal-anime-52299', category: 'ANIME', note: 'A dark fantasy about power and survival.' },
  { id: 'mal-manga-21', category: 'MANGA', note: 'A psychological duel about justice and power.' },
  {
    id: 'mal-manga-33327',
    category: 'MANGA',
    note: 'Identity, survival and psychological horror.',
  },
  { id: 'mal-manga-23390', category: 'MANGA', note: 'A brutal mystery behind humanity’s walls.' },
  {
    id: 'mal-manga-81117',
    category: 'MANGA',
    note: 'The next chapter in Tokyo Ghoul’s dark world.',
  },
  {
    id: 'mal-manga-111213',
    category: 'MANHWA',
    note: 'A tense family thriller and psychological mystery.',
  },
  { id: 'mal-manga-124845', category: 'MANHWA', note: 'Monster horror with a human heart.' },
  { id: 'mal-manga-29983', category: 'MANHWA', note: 'Ancient powers and supernatural conflict.' },
  { id: 'mal-manga-134744', category: 'MANHWA', note: 'Revenge, loyalty and martial arts.' },
];
export const araIds = araTitles.map(({ id }) => id);
export function isAraMedia(media) {
  const entry = araTitles.find(({ id }) => id === media?.id);
  if (!entry || media.category !== entry.category || media.isAdult) return false;
  const labels = [media.rating, ...(media.genres || [])].join(' ');
  return !/\b(Rx|R18|hentai|erotica|pornographic|explicit sex|ecchi)\b/i.test(labels);
}
