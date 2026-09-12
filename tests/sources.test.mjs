import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnimeSources, clearSourceCache } from '../server/sources-core.js';

const id = 'mal-anime-52991';
const media = {
  id,
  title: 'Frieren',
  category: 'ANIME',
  episodes: 28,
  externalLinks: [{ type: 'streaming', label: 'Crunchyroll', url: 'https://www.crunchyroll.com/' }],
};
const mapping = {
  id: 52991,
  type: 'anime',
  Sites: {
    KickAssAnime: {
      one: { type: 'anime', malId: 52991, aniId: 154587, url: 'https://kaa.lt/frieren' },
    },
    Crunchyroll: { one: { type: 'anime', url: 'https://www.crunchyroll.com/series/frieren' } },
  },
};
function dependencies({ mal = mapping, recent = { data: [] }, series, unavailable = false } = {}) {
  const calls = [];
  return {
    calls,
    offline: false,
    getMedia: async () => media,
    fetch: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, 'manual');
      if (unavailable) throw new Error('Provider offline');
      return Response.json(
        url.includes('malsync') ? mal : url.includes('/series/') ? series : recent,
      );
    },
  };
}
beforeEach(clearSourceCache);

test('generates MAL episode and language embeds without provider configuration', async () => {
  const result = await resolveAnimeSources(
    id,
    { episode: '2', language: 'dub' },
    { ...dependencies(), offline: true },
  );
  assert.equal(result.items[0].url, 'https://megaplay.buzz/stream/mal/52991/2/dub');
  assert.equal(result.items[0].supportsSynchronizedPlayback, false);
  assert.equal(result.items[0].availability, 'provider-managed');
});
test('rejects manga namespaces, invalid episode numbers, languages and unknown titles', async () => {
  for (const [mediaId, options] of [
    ['mal-manga-52991', {}],
    [id, { episode: 1.5 }],
    [id, { episode: 29 }],
    [id, { language: 'xx' }],
  ])
    await assert.rejects(resolveAnimeSources(mediaId, options, dependencies()));
  await assert.rejects(resolveAnimeSources(id, {}, { getMedia: async () => null }), /not be found/);
});
test('bridges only a unique AniList ID with an exact MAL match and favors exact provider links', async () => {
  const result = await resolveAnimeSources(id, {}, dependencies());
  assert.equal(
    result.items.find((x) => x.id === 'megaplay-anilist').url,
    'https://megaplay.buzz/stream/ani/154587/1/sub',
  );
  assert.equal(result.items.filter((x) => x.label === 'Crunchyroll').length, 1);
  assert.equal(
    result.items.find((x) => x.label === 'Crunchyroll').url,
    'https://www.crunchyroll.com/series/frieren',
  );
});
test('wrong or ambiguous mappings never cross into another anime', async () => {
  const wrong = structuredClone(mapping);
  wrong.Sites.KickAssAnime.one.malId = 21;
  let result = await resolveAnimeSources(id, {}, dependencies({ mal: wrong }));
  assert.ok(!result.items.some((x) => x.id === 'megaplay-anilist' || x.label === 'KickAssAnime'));
  clearSourceCache();
  const ambiguous = structuredClone(mapping);
  ambiguous.Sites.KickAssAnime.two = { ...ambiguous.Sites.KickAssAnime.one, aniId: 999 };
  result = await resolveAnimeSources(id, {}, dependencies({ mal: ambiguous }));
  assert.ok(!result.items.some((x) => x.id === 'megaplay-anilist'));
});
test('exact catalog episode matches are alternatives and cannot interrupt the primary player', async () => {
  const deps = dependencies({
    recent: { data: [null, { id: 123, mal_id: '52991' }] },
    series: {
      data: {
        anime: { mal_id: '52991' },
        episodes: [
          null,
          {
            number: 2,
            embed_url: {
              sub: 'https://megaplay.buzz/stream/s-2/456/sub',
            },
          },
        ],
      },
    },
  });
  const result = await resolveAnimeSources(id, { episode: 2 }, deps);
  assert.equal(result.items[0].id, 'megaplay-mal');
  assert.equal(
    result.items.find((x) => x.id === 'megaplay-episode').url,
    'https://megaplay.buzz/stream/s-2/456/sub',
  );
  const dub = await resolveAnimeSources(id, { episode: 2, language: 'dub' }, deps);
  assert.ok(!dub.items.some((x) => x.id === 'megaplay-episode'));
  assert.equal(deps.calls.length, 3, 'completed directory responses are cached');
});
test('failed or malformed optional directories retain a usable primary choice', async () => {
  for (const config of [
    { unavailable: true },
    { recent: { data: [null, false, {}] }, mal: null },
    { recent: { data: { items: {} } }, mal: [] },
  ]) {
    clearSourceCache();
    const result = await resolveAnimeSources(id, {}, dependencies(config));
    assert.equal(result.items[0].id, 'megaplay-mal');
  }
});
test('source IDs survive upstream reordering and unsafe external links are excluded', async () => {
  const first = await resolveAnimeSources(id, {}, dependencies());
  clearSourceCache();
  const reordered = {
    ...mapping,
    Sites: Object.fromEntries(Object.entries(mapping.Sites).reverse()),
  };
  const second = await resolveAnimeSources(id, {}, dependencies({ mal: reordered }));
  assert.equal(
    first.items.find((x) => x.label === 'Crunchyroll').id,
    second.items.find((x) => x.label === 'Crunchyroll').id,
  );
  clearSourceCache();
  const unsafe = structuredClone(mapping);
  unsafe.Sites.Crunchyroll.one.url = 'https://user:secret@localhost/admin';
  const result = await resolveAnimeSources(id, {}, dependencies({ mal: unsafe }));
  assert.ok(!result.items.some((x) => x.url.includes('secret')));
});
