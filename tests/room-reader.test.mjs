import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomReaderPath, readerAtUnit } from '../shared/room-reader.js';
const id = 'mal-manga-121496';
test('native reader links retain signed 64-bit source identities without numeric coercion', () => {
  const native = `ext-manga-${'a'.repeat(32)}`,
    edition = `ext-chapter-${'b'.repeat(32)}`;
  for (const source of ['-9223372036854775808', '9223372036854775807', '-123']) {
    const path = `/read/${native}/0?source=suwayomi:${source}&chapter=${edition}`;
    assert.equal(roomReaderPath(path, native, 0), path);
  }
  for (const source of ['0', '-0', '+1', '01', '9223372036854775808', '-9223372036854775809'])
    assert.equal(
      roomReaderPath(`/read/${native}/0?source=suwayomi:${source}&chapter=${edition}`, native, 0),
      null,
    );
});
test('native room readers preserve exact destination and edition syntax', () => {
  const native = `ext-manga-${'a'.repeat(32)}`;
  const edition = `ext-chapter-${'b'.repeat(32)}`;
  const link = `/ara-ara/read/${native}/2?source=suwayomi:123&chapter=${edition}&page=4`;
  assert.equal(roomReaderPath(link, native, 2, { destination: 'ara-ara' }), link);
  assert.equal(roomReaderPath(link, native, 2), null);
  assert.equal(
    roomReaderPath(link.replace('ara-ara/', ''), native, 2, { destination: 'ara-ara' }),
    null,
  );
  assert.equal(
    roomReaderPath(link.replace(edition, 'made-up'), native, 2, { destination: 'ara-ara' }),
    null,
  );
  assert.equal(
    roomReaderPath(link + '&source=mangadex', native, 2, { destination: 'ara-ara' }),
    null,
  );
  assert.equal(roomReaderPath(link, native, 2, { destination: 'invalid' }), null);
  assert.equal(
    readerAtUnit(link, native, 3, { destination: 'ara-ara' }),
    `/ara-ara/read/${native}/3?source=suwayomi%3A123`,
  );
});
test('shared reader preserves edition and language but rejects other routes and origins', () => {
  const link = `/read/${id}/4.5?source=mangadex&language=ja&chapter=edition-id&page=3`;
  assert.equal(roomReaderPath(link, id, 4.5), link);
  assert.equal(roomReaderPath(`/read/${id}/0`, id, 0), `/read/${id}/0`);
  assert.equal(
    roomReaderPath(`/read/${id}/4.50?chapter=exact`, id, 4.5),
    `/read/${id}/4.5?chapter=exact`,
  );
  assert.equal(roomReaderPath(`/read/${id}/0.0`, id, 0), `/read/${id}/0`);
  assert.equal(roomReaderPath(`/read/${id}/01`, id, 1), `/read/${id}/1`);
  for (const value of [
    'https://other.test/read',
    '//other.test',
    '/settings',
    `/read/${id}/5`,
    `/read/${id}/4.5?redirect=https://other.test`,
    `/read/${id}/4.5?source=unknown`,
  ]) {
    assert.equal(roomReaderPath(value, id, 4.5), null);
  }
  assert.equal(readerAtUnit(link, id, 6), `/read/${id}/6?source=mangadex&language=ja`);
});
