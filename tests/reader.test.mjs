import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseManifest,
  filterChapters,
  readerPreferences,
  pageStep,
  chapterUnit,
  sortChapters,
} from '../src/reader/model.js';

const pages = ['https://images.example.org/page-1.jpg'];
const document = {
  title: 'Test story',
  chapters: {
    10: { volume: '2', title: 'Finale', language: 'en', groups: { Alpha: pages } },
    1.5: { volume: '1', title: 'Interlude', language: 'en', groups: { Alpha: pages, Beta: pages } },
    2: { volume: '1', title: 'Arrival', language: 'es', groups: { Gamma: pages } },
    0: { volume: '1', title: 'Prologue', language: 'en', groups: { Alpha: pages } },
  },
};
test('chapter parsing keeps decimals, zero and alternate editions distinct in natural order', () => {
  const result = parseManifest(document);
  assert.deepEqual(
    result.map((x) => x.number),
    ['0', '1.5', '1.5', '2', '10'],
  );
  assert.equal(new Set(result.map((x) => x.id)).size, 5);
  assert.equal(result[1].group, 'Alpha');
  assert.equal(result[2].group, 'Beta');
  assert.notEqual(parseManifest({ ...document, title: 'Other edition' })[0].id, result[0].id);
});
test('invalid or dangerous manifests fail as a whole without silently dropping pages', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:image/svg+xml,test',
    'http://images.example.org/p.jpg',
    'https://127.0.0.1/p.jpg',
    'https://user:secret@example.org/p.jpg',
    'https://example.local/p.jpg',
  ]) {
    assert.throws(
      () => parseManifest({ chapters: { 1: { groups: { A: [pages[0], url] } } } }),
      /HTTPS/,
    );
  }
  assert.throws(() => parseManifest({ chapters: { 1: { groups: { A: [] } } } }), /page/i);
  assert.throws(
    () => parseManifest({ chapters: { 1: { groups: { A: Array(501).fill(pages[0]) } } } }),
    /500/,
  );
  assert.throws(() => parseManifest({ chapters: [] }));
});
test('chapter filters intersect language, volume, unread and bookmark state without mutating source', () => {
  const chapters = parseManifest(document);
  const states = { [chapters[1].id]: { read: true }, [chapters[2].id]: { bookmark: 1 } };
  assert.deepEqual(
    filterChapters(
      chapters,
      { language: 'en', volume: '1', status: 'unread', query: 'interlude' },
      states,
    ).map((x) => x.group),
    ['Beta'],
  );
  assert.deepEqual(
    filterChapters(chapters, { status: 'bookmarked' }, states).map((x) => x.group),
    ['Beta'],
  );
  assert.equal(filterChapters(chapters, { sort: 'desc' }, states)[0].number, '10');
  assert.equal(chapters[0].number, '0');
});
test('reader defaults fit each format and corrupt preferences cannot create invalid layouts', () => {
  assert.equal(readerPreferences({}, 'MANHWA').mode, 'webtoon');
  assert.equal(readerPreferences({}, 'MANGA').direction, 'rtl');
  assert.equal(readerPreferences({}, 'MANGA').mode, 'single');
  assert.equal(readerPreferences({}, 'MANGA').fit, 'both');
  assert.equal(readerPreferences({}, 'MANHWA').fit, 'width');
  assert.equal(readerPreferences({ mode: 'webtoon', fit: 'both' }).fit, 'width');
  assert.equal(readerPreferences({ mode: 'double', direction: 'ltr' }).direction, 'ltr');
  const bad = readerPreferences(
    { mode: 'video', direction: 'down', width: -30, background: 'url(evil)', fit: 'foo' },
    'MANGA',
  );
  assert.equal(bad.mode, 'single');
  assert.equal(bad.width, 400);
  assert.equal(bad.background, 'dark');
  assert.equal(readerPreferences({ gap: 0 }).gap, 0);
});
test('chapter units preserve zero and bonus chapters without inventing numeric identities', () => {
  assert.equal(chapterUnit('0'), 0);
  assert.equal(chapterUnit('1.5'), 1.5);
  assert.equal(chapterUnit('Extra'), null);
  assert.equal(chapterUnit(''), null);
  assert.deepEqual(
    sortChapters([
      { volume: '2', number: '1' },
      { volume: '1', number: '2' },
      { volume: '1', number: '1' },
    ]).map(({ volume, number }) => `${volume}:${number}`),
    ['1:1', '1:2', '2:1'],
  );
});
test('page navigation never skips the last odd spread or exceeds chapter bounds', () => {
  assert.equal(pageStep(1, 1, 5, 'double'), 3);
  assert.equal(pageStep(3, 1, 5, 'double'), 5);
  assert.equal(pageStep(5, 1, 5, 'double'), 5);
  assert.equal(pageStep(1, -1, 5, 'single'), 1);
  assert.equal(pageStep(5, -1, 5, 'double'), 3);
  assert.equal(pageStep(3, 1, 4, 'double'), 3);
  assert.equal(pageStep(1, 1, 2, 'double'), 1);
});
test('bonus chapters sort by their decimal value rather than digit chunks', () => {
  const chapters = ['1.05', '1.1', '1.2', '1.9', '1.10', '1.25'].map((number) => ({
    number,
    volume: '1',
    group: 'A',
  }));
  assert.deepEqual(
    sortChapters(chapters).map((c) => c.number),
    ['1.05', '1.1', '1.10', '1.2', '1.25', '1.9'],
  );
});
test('mixed numeric and bonus chapter names have consistent order regardless of import order', () => {
  const values = ['1.05', '1.1 Extra', '1.1'];
  for (const numbers of [values, [...values].reverse(), ['1.1', '1.05', '1.1 Extra']]) {
    assert.deepEqual(
      sortChapters(numbers.map((number) => ({ number, volume: '1', group: 'A' }))).map(
        (c) => c.number,
      ),
      ['1.05', '1.1', '1.1 Extra'],
    );
  }
});
