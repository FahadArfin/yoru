import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gifUrl,
  gifToken,
  emoteToken,
  commentParts,
  commentMediaError,
  commentPreview,
} from '../shared/comment-media.js';

test('comment media accepts direct provider images without allowing arbitrary remote content', () => {
  const good = 'https://media.giphy.com/media/example/giphy.gif';
  assert.equal(gifUrl(good), good);
  for (const bad of [
    'javascript:alert(1)',
    'http://media.giphy.com/a.gif',
    'https://media.giphy.com.evil.test/a.gif',
    'https://user@media.giphy.com/a.gif',
    'https://media.giphy.com:8443/a.gif',
    'https://localhost/a.gif',
    'https://media.tenor.com/a.svg',
    'https://giphy.com/gifs/example',
  ])
    assert.equal(gifUrl(bad), '');
  assert.equal(commentMediaError(gifToken(good)), '');
  assert.match(commentMediaError(gifToken('https://evil.test/a.gif')), /direct GIF/);
  assert.match(commentMediaError(`${gifToken(good)} ${gifToken(good)}`), /one GIF/);
});
test('media tokens round trip alongside unicode, plain links and literal HTML', () => {
  const body = `Great 😂 ${emoteToken({ id: 123, name: 'OMEGALUL' })}\n${gifToken('https://media.tenor.com/abc/reaction.gif')} <script>alert(1)</script>`;
  const parts = commentParts(body);
  assert.deepEqual(
    parts.map((part) => part.type),
    ['text', 'emote', 'text', 'gif', 'text'],
  );
  assert.equal(parts[1].url, 'https://cdn.frankerfacez.com/emote/123/2');
  assert.match(commentPreview(body), /Great 😂 OMEGALUL\n\[GIF\]/);
  assert.equal(commentParts('![GIF](https://evil.test/a.gif)')[0].type, 'text');
  assert.equal(commentParts('[[ffz:../bad:Oops]]')[0].type, 'text');
  assert.match(commentMediaError(emoteToken({ id: 123, name: 'Wow' }).repeat(31)), /30 emotes/);
});
