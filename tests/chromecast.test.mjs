import test from 'node:test';
import assert from 'node:assert/strict';
import { castMediaDescriptor, castErrorMessage } from '../src/chromecast.js';

test('Cast sends direct media with its actual type and never sends an embed URL', () => {
  assert.equal(castMediaDescriptor({ kind: 'embed', url: 'https://megaplay.buzz/stream/1' }), null);
  assert.equal(castMediaDescriptor({ kind: 'external', url: 'https://example.org/watch' }), null);
  assert.deepEqual(
    castMediaDescriptor({ kind: 'hls', url: 'https://cdn.example/video?token=abc' }),
    {
      url: 'https://cdn.example/video?token=abc',
      contentType: 'application/x-mpegURL',
    },
  );
  assert.equal(
    castMediaDescriptor({ kind: 'video', url: 'https://cdn.example/a.m3u8?q=1' }).contentType,
    'application/x-mpegURL',
  );
  assert.equal(
    castMediaDescriptor({ kind: 'video', url: 'https://cdn.example/a.webm' }).contentType,
    'video/webm',
  );
  assert.equal(
    castMediaDescriptor({ kind: 'video', url: 'https://cdn.example/a.mp4' }).contentType,
    'video/mp4',
  );
});

test('Cast rejects browser-local blobs, credentials and insecure URLs', () => {
  for (const url of [
    'blob:https://yoru.example/123',
    'data:video/mp4,test',
    'http://cdn.example/a.mp4',
    'https://user:password@cdn.example/a.mp4',
  ]) {
    assert.equal(castMediaDescriptor({ kind: 'video', url }), null);
  }
});

test('Cast errors do not leak signed URLs and cancellation is quiet', () => {
  assert.equal(castErrorMessage({ code: 'cancel' }), '');
  assert.equal(castErrorMessage('cancel'), '');
  assert.match(castErrorMessage({ code: 'receiver_unavailable' }), /same Wi-Fi/);
  assert.doesNotMatch(
    castErrorMessage(new Error('https://cdn.example/private?secret=123')),
    /secret/,
  );
});
