import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAnimeCast, normalizeCast } from '../server/anime-cast.js';
const character = (id, role = 'Supporting') => ({
  character: {
    mal_id: id,
    name: `Character ${id}`,
    images: { jpg: { image_url: 'javascript:bad' } },
  },
  role,
  voice_actors: [
    { person: { mal_id: 10, name: '<b>Actor</b>' }, language: 'Japanese' },
    { person: { mal_id: 10, name: 'Actor' }, language: 'Japanese' },
  ],
});
test('cast normalizes portraits and credits, deduplicates, and puts main characters first', () => {
  const items = normalizeCast({
    data: [character(1), character(2, 'Main'), character(1), { character: null }],
  });
  assert.deepEqual(
    items.map((x) => x.id),
    [2, 1],
  );
  assert.equal(items[0].image, null);
  assert.deepEqual(items[0].actors, [{ id: 10, name: 'Actor', image: null, language: 'Japanese' }]);
  assert.throws(() => normalizeCast({}), /unavailable/);
});
test('cast caches verified credits and keeps stale results on provider failure', async () => {
  let saved,
    calls = 0;
  const options = {
    media: async () => ({ id: 'mal-anime-1', category: 'ANIME' }),
    request: async () => {
      calls++;
      return { data: [character(1)] };
    },
    now: 1000,
    load: async () => saved,
    save: async (_, v) => {
      saved = v;
    },
  };
  assert.equal((await getAnimeCast('mal-anime-1', options)).items.length, 1);
  assert.equal((await getAnimeCast('mal-anime-1', options)).partial, false);
  assert.equal(calls, 1);
  const stale = await getAnimeCast('mal-anime-1', {
    ...options,
    now: 1000 + 86400001,
    request: async () => {
      throw Error('offline');
    },
  });
  assert.equal(stale.partial, true);
  assert.equal(stale.items.length, 1);
  await assert.rejects(getAnimeCast('mal-manga-1', options));
  await assert.rejects(
    getAnimeCast('mal-anime-1', {
      ...options,
      media: async () => ({ id: 'mal-anime-1', category: 'ANIME', isAdult: true }),
    }),
  );
});
