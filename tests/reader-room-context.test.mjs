import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectEvents } from '../src/realtime.js';
import { readerMutation } from '../src/reader/requests.js';

const context = {
  owner: 'guest',
  scope: 'guest',
  destination: 'ara-ara',
  integrationMode: 'core',
  selectionFingerprint: 'room-selection',
  expiresAt: Date.now() + 60_000,
};

test('room channels require current context, carry Ara, and close on cancellation or expiry', async (t) => {
  const streams = [];
  const Original = globalThis.EventSource;
  globalThis.EventSource = class {
    constructor(path) {
      this.path = path;
      this.listeners = {};
      streams.push(this);
    }
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }
    close() {
      this.closed = true;
    }
  };
  t.after(() => {
    globalThis.EventSource = Original;
  });
  let delivered = 0;
  connectEvents({ roomId: 'r', context: null });
  connectEvents({ roomId: 'r', context: { ...context, expiresAt: 1 } });
  assert.equal(streams.length, 0);
  const controller = new AbortController();
  const connection = connectEvents({
    roomId: 'r',
    context: { ...context, signal: controller.signal },
    onEvent: () => delivered++,
  });
  const url = new URL(streams[0].path, 'https://yoru.test');
  assert.equal(url.searchParams.get('destination'), 'ara-ara');
  assert.equal(url.searchParams.get('selectionFingerprint'), 'room-selection');
  assert.equal(url.searchParams.has('owner'), false);
  streams[0].listeners.room({ type: 'room' });
  controller.abort();
  streams[0].listeners.room({ type: 'room' });
  assert.equal(delivered, 1);
  assert.equal(streams[0].closed, true);
  connection.close();
  const expiring = connectEvents({
    roomId: 'r',
    context: { ...context, expiresAt: Date.now() + 10 },
    onEvent: () => delivered++,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  streams[1].listeners.room({ type: 'room' });
  assert.equal(streams[1].closed, true);
  assert.equal(delivered, 1);
  expiring.close();
});

test('room polling drops a late previous-context response and never starts after expiry', async (t) => {
  let finish;
  const calls = [];
  t.mock.method(globalThis, 'fetch', (path) => {
    calls.push(path);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  let delivered = 0;
  const controller = new AbortController();
  const connection = connectEvents({
    transport: 'poll',
    roomId: 'r',
    context: { ...context, signal: controller.signal },
    onEvent: () => delivered++,
  });
  assert.equal(new URL(calls[0], 'https://yoru.test').searchParams.get('destination'), 'ara-ara');
  controller.abort();
  finish(Response.json({ online: [], room: { id: 'r' }, events: [], cursor: 0 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(delivered, 0);
  connection.close();
  connectEvents({ transport: 'poll', roomId: 'r', context: { ...context, expiresAt: 1 } });
  assert.equal(calls.length, 1);
});

test('room and comment mutations preserve destination and exact edition and reject expired work', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, options });
    return Response.json({ ok: true });
  });
  await readerMutation(
    '/api/comments/ext-manga-11111111111111111111111111111111',
    { unit: 0, edition: `ext-chapter-${'2'.repeat(32)}`, body: 'Exact edition' },
    'POST',
    context,
  );
  const call = calls[0];
  assert.equal(new URL(call.path, 'https://yoru.test').searchParams.get('destination'), 'ara-ara');
  assert.equal(JSON.parse(call.options.body).edition, `ext-chapter-${'2'.repeat(32)}`);
  await assert.rejects(
    readerMutation('/api/rooms/r', {}, 'PATCH', { ...context, expiresAt: 1 }),
    /expired/,
  );
  assert.equal(calls.length, 1);
});
