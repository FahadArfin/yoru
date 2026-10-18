import test from 'node:test';
import assert from 'node:assert/strict';
import { titleRelevance, rankSearch } from '../server/search-ranking.js';

test('exact titles beat more popular spinoffs and alternate titles remain searchable', () => {
  const items = [
    { id: 'sequel', title: 'Attack on Titan Final Season', popularity: 1 },
    { id: 'original', title: 'Attack on Titan', popularity: 50 },
    { id: 'other', title: 'Before the Attack on Titan', popularity: 2 },
  ];
  assert.deepEqual(
    rankSearch(items, 'attack on titan').map((x) => x.id),
    ['original', 'sequel', 'other'],
  );
  assert.equal(
    titleRelevance(
      { title: 'Shingeki no Kyojin', titleEnglish: 'Attack on Titan' },
      'Attack on Titan',
    ),
    10000,
  );
  assert.equal(titleRelevance({ synonyms: ['進撃の巨人'] }, '進撃の巨人'), 10000);
  assert.equal(titleRelevance({ title: 'Pokémon' }, 'pokemon'), 10000);
  assert.equal(titleRelevance({ title: 'One-Punch Man' }, 'one punch man'), 10000);
  assert.equal(titleRelevance({ title: 'Attack on Titan' }, 'one piece'), -1);
  assert.ok(titleRelevance({ title: 'Attack on Titan' }, 'titan attack') > 0);
});
