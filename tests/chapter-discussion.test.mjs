import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterDiscussionLink } from '../shared/chapter-discussion.js';

test('numbered chapters share a thread across translations without mixing chapters', () => {
  assert.equal(
    chapterDiscussionLink('mal-manga-1121', { number: '23' }),
    '/title/mal-manga-1121?unit=23#chapter-discussion',
  );
  assert.notEqual(
    chapterDiscussionLink('mal-manga-1121', { number: '24' }),
    chapterDiscussionLink('mal-manga-1121', { number: '23' }),
  );
});

test('zero, fractional and special chapters retain exact identities instead of joining the title thread', () => {
  const id = '0abaccd2-efb3-4aa1-a4ef-8f25726d156c';
  for (const number of ['0', '1.5', null]) {
    const url = new URL(
      chapterDiscussionLink('mal-manga-1121', { id, number }),
      'https://yoru.invalid',
    );
    assert.equal(url.searchParams.get('edition'), id);
    assert.equal(url.searchParams.get('unit'), '0');
    assert.equal(url.searchParams.get('chapter'), number ?? 'Special chapter');
  }
  assert.equal(chapterDiscussionLink('mal-manga-1121', { number: '1.5', id: 'device-only' }), null);
});

test('extension chapter links always retain their permanent edition identity and decimal label', () => {
  const mediaId = `ext-manga-${'a'.repeat(32)}`;
  const id = `ext-chapter-${'b'.repeat(32)}`;
  const url = new URL(
    chapterDiscussionLink(mediaId, { id, number: '1.5' }),
    'https://yoru.invalid',
  );
  assert.equal(url.searchParams.get('edition'), id);
  assert.equal(url.searchParams.get('unit'), '1.5');
  assert.equal(chapterDiscussionLink(mediaId, { number: '1' }), null);
});
