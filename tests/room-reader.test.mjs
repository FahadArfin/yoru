import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomReaderPath, readerAtUnit } from '../shared/room-reader.js';
const id = 'mal-manga-121496';
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
