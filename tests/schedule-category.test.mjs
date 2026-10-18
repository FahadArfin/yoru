import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleCategory } from '../shared/schedule-category.js';

test('reviewed family series take priority over country and release language', () => {
  for (const airType of ['raw', 'sub', 'dub']) {
    assert.equal(scheduleCategory({ route: 'pokemon-2023', airType }), 'cartoons');
    assert.equal(scheduleCategory({ route: 'sazae-san', airType, donghua: true }), 'cartoons');
  }
});

test('country grouping uses provider donghua and reviewed Korean production', () => {
  assert.equal(scheduleCategory({ route: 'gaiken-shijou-shugi' }), 'korean');
  assert.equal(scheduleCategory({ route: 'example', donghua: true }), 'chinese');
  assert.equal(scheduleCategory({ route: 'ore-dake-level-up-na-ken' }), 'japanese');
});

test('titles and broad age ratings do not imply a children’s show', () => {
  assert.equal(
    scheduleCategory({ route: 'sakamichi-no-apollon', title: 'Kids on the Slope', rating: 'PG' }),
    'japanese',
  );
  assert.equal(scheduleCategory({ route: 'unreviewed', title: 'Doraemon' }), 'japanese');
});
