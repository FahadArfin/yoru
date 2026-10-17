import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupChapterEditions } from '../src/reader/chapter-groups.js';

test('chapter directory groups translations, keeps specials distinct, and orders fractional chapters', () => {
  const rows = [
    { id: 'a', number: '1.5', volume: '2', language: 'en' },
    { id: 'b', number: '1.5', volume: '2', language: 'pt-br' },
    { id: 'c', number: '1.10', volume: '2', language: 'en' },
    { id: 'd', number: '9', volume: null, language: 'en' },
    { id: 'e', number: null, volume: '2', title: 'Extra A' },
    { id: 'f', number: null, volume: '2', title: 'Extra B' },
    { id: 'g', number: '2', volume: '10', language: 'en' },
  ];
  const grouped = groupChapterEditions(rows, 'desc');
  assert.deepEqual(
    grouped.map((v) => v.label),
    ['No volume', 'Volume 10', 'Volume 2'],
  );
  const volume = grouped[2];
  assert.equal(volume.count, 5);
  assert.deepEqual(
    volume.chapters.map((c) => c.number),
    ['1.5', '1.10', null, null],
  );
  assert.deepEqual(
    volume.chapters[0].items.map((r) => r.id),
    ['a', 'b'],
  );
  const ascending = groupChapterEditions(rows, 'asc');
  assert.deepEqual(
    ascending.map((v) => v.label),
    ['No volume', 'Volume 2', 'Volume 10'],
  );
  assert.deepEqual(
    ascending[1].chapters.slice(0, 2).map((c) => c.number),
    ['1.10', '1.5'],
  );
  assert.equal(rows[0].id, 'a');
});

test('the same chapter number in different volumes stays separate and repeated pages do not duplicate editions', () => {
  const first = { id: 'one', number: '1', volume: '1' };
  const grouped = groupChapterEditions([first, first, { id: 'two', number: '1', volume: '2' }]);
  assert.equal(grouped.length, 2);
  assert.equal(
    grouped.reduce((sum, v) => sum + v.count, 0),
    2,
  );
  assert.deepEqual(groupChapterEditions([]), []);
});
