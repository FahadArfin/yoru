import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRuntime, migrate, sql } from './harness.mjs';

const directory = mkdtempSync(join(tmpdir(), 'yoru-sites-'));
let runtime,
  alice,
  bob,
  charlie,
  media = 'mal-anime-52991';
const streams = [];
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function request(
  instance,
  path,
  { method = 'GET', body, session, origin = `http://${instance}.test`, headers = {} } = {},
) {
  const response = await runtime.dispatchFetch(`http://${instance}.test${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
      ...(session ? { cookie: session.cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function register(name) {
  const response = await request('a', '/api/auth/register', {
    method: 'POST',
    body: { name, email: `${name.toLowerCase()}@example.test`, password: 'correct-horse-battery' },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { user: response.body.user, cookie, hash: hash(decodeURIComponent(cookie.split('=')[1])) };
}
async function eventStream(instance, session, roomId, headers = {}) {
  const response = await runtime.dispatchFetch(
    `http://${instance}.test/api/events${roomId ? `?roomId=${roomId}` : ''}`,
    { headers: { ...(session ? { cookie: session.cookie } : {}), ...headers } },
  );
  assert.equal(response.status, 200);
  const reader = response.body.getReader(),
    events = [];
  let ended = false,
    buffer = '';
  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);
        let position;
        while ((position = buffer.indexOf('\n\n')) >= 0) {
          const record = buffer.slice(0, position);
          buffer = buffer.slice(position + 2);
          const event = record.match(/^event: ?(.+)$/m)?.[1],
            data = record.match(/^data: ?(.+)$/m)?.[1],
            id = record.match(/^id: ?(.+)$/m)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data), id });
        }
      }
    } catch {
    } finally {
      ended = true;
    }
  })();
  const item = {
    events,
    pump,
    get ended() {
      return ended;
    },
    close: () => reader.cancel().catch(() => {}),
    async wait(event, predicate = () => true) {
      for (let i = 0; i < 200; i++) {
        const found = events.find((x) => x.event === event && predicate(x.data));
        if (found) return found;
        if (ended) break;
        await new Promise((done) => setTimeout(done, 25));
      }
      throw new Error(`Missing SSE ${event}: ${JSON.stringify(events)}`);
    },
  };
  streams.push(item);
  await item.wait('snapshot');
  return item;
}
before(async () => {
  runtime = await createRuntime({ persist: directory });
  await migrate(runtime);
});
after(async () => {
  await Promise.all(streams.map((x) => x.close()));
  await runtime?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

test('independent Workers share durable sessions and enforce browser origins', async () => {
  assert.equal((await request('a', '/__test/instance')).body.instance, 'a');
  assert.equal((await request('b', '/__test/instance')).body.instance, 'b');
  assert.equal((await request('b', '/api/health')).body.persistence, 'd1');
  alice = await register('Alice');
  bob = await register('Bob');
  charlie = await register('Charlie');
  assert.equal(
    (await request('b', '/api/auth/me', { session: alice })).body.user.id,
    alice.user.id,
  );
  assert.equal(
    (
      await request('a', '/api/chat', {
        method: 'POST',
        session: alice,
        origin: 'https://evil.test',
        body: { body: 'blocked' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request('a', '/api/chat', { method: 'POST', body: { body: 'blocked' } })).status,
    401,
  );
  const secure = await request('a', '/api/auth/login', {
    method: 'POST',
    body: { email: 'alice@example.test', password: 'correct-horse-battery' },
  });
  assert.match(secure.headers.get('set-cookie'), /HttpOnly/);
  assert.equal(secure.body.user.password_hash, undefined);
  // Remove this extra session so later logout checks cover full revocation.
  await request('b', '/api/auth/logout', {
    method: 'POST',
    body: {},
    session: { cookie: secure.headers.get('set-cookie').split(';')[0] },
  });
});
test('concurrent library partial updates merge without overwriting one another', async () => {
  const results = await Promise.all([
    request('a', `/api/library/${media}`, {
      method: 'PUT',
      session: alice,
      body: { favorite: true },
    }),
    request('b', `/api/library/${media}`, {
      method: 'PUT',
      session: alice,
      body: { progress: 7, status: 'watching', score: 9 },
    }),
  ]);
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.body));
  const item = (await request('b', '/api/library', { session: alice })).body.items[0];
  assert.equal(item.favorite, true);
  assert.equal(item.progress, 7);
  assert.equal(item.score, 9);
  assert.equal((await request('a', '/api/library', { session: bob })).body.items.length, 0);
});
test('nested discussions, votes and concurrent reviews preserve their ownership and scope', async () => {
  const comment = await request('a', `/api/comments/${media}`, {
    method: 'POST',
    session: alice,
    body: { unit: 2, body: 'A thoughtful episode.', spoiler: true },
  });
  assert.equal(comment.status, 201);
  assert.equal(
    (
      await request('b', `/api/comments/${media}`, {
        method: 'POST',
        session: bob,
        body: { unit: 3, parentId: comment.body.comment.id, body: 'Wrong thread' },
      })
    ).status,
    400,
  );
  await request('b', `/api/comments/${comment.body.comment.id}/vote`, {
    method: 'POST',
    session: bob,
    body: { value: 1 },
  });
  const items = (await request('a', `/api/comments/${media}?unit=2`, { session: bob })).body.items;
  assert.equal(items[0].score, 1);
  assert.equal(items[0].viewerVote, 1);
  assert.equal(items[0].spoiler, true);
  await Promise.all(
    ['a', 'b'].map((instance) =>
      request(instance, `/api/reviews/${media}`, {
        method: 'POST',
        session: alice,
        body: {
          rating: 9,
          title: 'Worth watching',
          body: 'The pacing and characters make this wonderful.',
        },
      }),
    ),
  );
  assert.equal((await request('b', `/api/reviews/${media}`)).body.items.length, 1);
  assert.equal(
    (
      await request('b', `/api/comments/${comment.body.comment.id}`, {
        method: 'DELETE',
        session: bob,
        body: {},
      })
    ).status,
    404,
  );
});
test('presence deduplicates users and chat crosses isolates with replayable event IDs', async () => {
  const a = await eventStream('a', alice),
    b = await eventStream('b', alice),
    guest = await eventStream('b', bob);
  assert.equal((await request('b', '/api/online')).body.count, 2);
  const sent = await request('a', '/api/chat', {
    method: 'POST',
    session: alice,
    body: { body: 'Across both servers' },
  });
  const event = await b.wait('chat', (x) => x.message.id === sent.body.message.id);
  assert.ok(Number(event.id) > 0);
  await a.close();
  assert.equal((await request('b', '/api/online')).body.count, 2);
  await b.close();
  const missed = await request('a', '/api/chat', {
    method: 'POST',
    session: bob,
    body: { body: 'Sent during reconnect' },
  });
  const replay = await eventStream('b', alice, null, { 'last-event-id': event.id });
  await replay.wait('chat', (x) => x.message.id === missed.body.message.id);
  await replay.close();
  await guest.close();
});
let room;
test('simultaneous final-seat joins and versioned host changes are atomic', async () => {
  const created = await request('a', '/api/rooms', {
    method: 'POST',
    session: alice,
    body: { name: 'Last seat', mediaId: media, type: 'watch', capacity: 2 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  room = created.body.room;
  const races = await Promise.all([
    request('a', `/api/rooms/${room.id}/join`, { method: 'POST', session: bob, body: {} }),
    request('b', `/api/rooms/${room.id}/join`, { method: 'POST', session: charlie, body: {} }),
  ]);
  assert.deepEqual(races.map((x) => x.status).sort(), [200, 409]);
  const host = await request('a', `/api/rooms/${room.id}`, { session: alice });
  const updates = await Promise.all(
    ['a', 'b'].map((instance, i) =>
      request(instance, `/api/rooms/${room.id}`, {
        method: 'PATCH',
        session: alice,
        body: { unit: 3 + i, version: host.body.room.version },
      }),
    ),
  );
  assert.deepEqual(updates.map((x) => x.status).sort(), [200, 409]);
  const member = races[0].status === 200 ? bob : charlie;
  assert.equal(
    (
      await request('b', `/api/rooms/${room.id}`, {
        method: 'PATCH',
        session: member,
        body: { unit: 8 },
      })
    ).status,
    403,
  );
});
let privateRoom;
test('private invitations never authorize chat or expose sources before membership', async () => {
  const created = await request('a', '/api/rooms', {
    method: 'POST',
    session: alice,
    body: { name: 'Private circle', mediaId: media, visibility: 'private', capacity: 4 },
  });
  privateRoom = created.body.room;
  await request('a', `/api/rooms/${privateRoom.id}`, {
    method: 'PATCH',
    session: alice,
    body: { sourceUrl: 'https://example.com/private.mp4', sourceKind: 'video' },
  });
  assert.equal((await request('b', `/api/rooms/${privateRoom.id}`, { session: bob })).status, 404);
  const preview = await request('b', `/api/rooms/${privateRoom.id}?invite=${created.body.invite}`, {
    session: bob,
  });
  assert.equal(preview.body.room.joined, false);
  assert.equal(preview.body.room.sourceUrl, '');
  assert.equal(
    (await request('b', `/api/rooms/${privateRoom.id}/chat`, { session: bob })).status,
    403,
  );
  assert.equal(
    (
      await request('b', `/api/rooms/${privateRoom.id}/join`, {
        method: 'POST',
        session: bob,
        body: { invite: 'wrong' },
      })
    ).status,
    403,
  );
  await request('b', `/api/rooms/${privateRoom.id}/join`, {
    method: 'POST',
    session: bob,
    body: { invite: created.body.invite },
  });
  const follower = await eventStream('b', bob, privateRoom.id),
    publicStream = await eventStream('a', charlie);
  const chat = await request('a', `/api/rooms/${privateRoom.id}/chat`, {
    method: 'POST',
    session: alice,
    body: { body: 'Members only' },
  });
  await follower.wait('chat', (x) => x.message.id === chat.body.message.id);
  assert.equal(
    publicStream.events.some((x) => x.data.message?.id === chat.body.message.id),
    false,
  );
  await request('b', `/api/rooms/${privateRoom.id}/leave`, {
    method: 'POST',
    session: bob,
    body: {},
  });
  await follower.wait('left');
  assert.equal(
    (await request('a', `/api/rooms/${privateRoom.id}/chat`, { session: bob })).status,
    403,
  );
  await follower.close();
  await publicStream.close();
  await request('b', `/api/rooms/${privateRoom.id}/join`, {
    method: 'POST',
    session: bob,
    body: { invite: created.body.invite },
  });
});
test('large XML import is set-based, preserves favorites, and rolls back every change on failure', async () => {
  const entries = Array.from(
    { length: 5000 },
    (_, i) =>
      `<anime><series_animedb_id>${900000 + i}</series_animedb_id><series_title>Title ${i}</series_title><my_status>Watching</my_status><my_watched_episodes>3</my_watched_episodes></anime>`,
  ).join('');
  const xml = `<myanimelist>${entries}</myanimelist>`;
  assert.equal(
    (await request('b', '/api/import/preview', { method: 'POST', body: { xml } })).body.total,
    5000,
  );
  const committed = await request('b', '/api/import/commit', {
    method: 'POST',
    session: charlie,
    body: { xml },
  });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  assert.equal(committed.body.imported, 5000);
  assert.equal(
    (
      await sql(runtime, [
        ['SELECT COUNT(*) AS count FROM library WHERE user_id=?', charlie.user.id],
      ])
    )[0].results[0].count,
    5000,
  );
  await sql(runtime, [
    [
      `CREATE TRIGGER fail_import BEFORE UPDATE ON library WHEN NEW.user_id='${charlie.user.id}' AND NEW.media_id='mal-anime-904999' BEGIN SELECT RAISE(ABORT,'injected failure'); END`,
    ],
  ]);
  const failed = await request('a', '/api/import/commit', {
    method: 'POST',
    session: charlie,
    body: { xml: xml.replaceAll('<my_watched_episodes>3', '<my_watched_episodes>8') },
  });
  assert.equal(failed.status, 500);
  assert.equal(
    (
      await sql(runtime, [
        ['SELECT COUNT(*) AS count FROM library WHERE user_id=? AND progress=3', charlie.user.id],
      ])
    )[0].results[0].count,
    5000,
  );
  await sql(runtime, [['DROP TRIGGER fail_import']]);
});
test('favorites previews are durable, session-bound, single-use, and preserve progress', async () => {
  const token = randomBytes(32).toString('base64url');
  await sql(runtime, [
    [
      'INSERT INTO favorite_previews(token_hash,session_hash,user_id,username,items,expires_at) VALUES(?,?,?,?,?,?)',
      hash(token),
      alice.hash,
      alice.user.id,
      'PublicUser',
      JSON.stringify([{ mediaId: media, malId: 52991, title: 'Frieren', type: 'ANIME' }]),
      Date.now() + 600000,
    ],
  ]);
  assert.equal(
    (
      await request('b', '/api/import/favorites/commit', {
        method: 'POST',
        session: bob,
        body: { previewToken: token },
      })
    ).status,
    400,
  );
  const commits = await Promise.all(
    ['a', 'b'].map((instance) =>
      request(instance, '/api/import/favorites/commit', {
        method: 'POST',
        session: alice,
        body: { previewToken: token },
      }),
    ),
  );
  assert.deepEqual(commits.map((x) => x.status).sort(), [200, 400]);
  const item = (await request('b', '/api/library', { session: alice })).body.items[0];
  assert.equal(item.progress, 7);
  assert.equal(item.favorite, true);
  assert.equal(item.score, 9);
});
test('logout on another isolate stops private events and transfers the host', async () => {
  await request('a', `/api/rooms/${privateRoom.id}`, {
    method: 'PATCH',
    session: alice,
    body: { paused: false, position: 20 },
  });
  const anchor = new Date(Date.now() - 60000).toISOString();
  await sql(runtime, [['UPDATE rooms SET state_updated_at=? WHERE id=?', anchor, privateRoom.id]]);
  const host = await eventStream('a', alice, privateRoom.id),
    follower = await eventStream('b', bob, privateRoom.id);
  await request('b', '/api/auth/logout', { method: 'POST', session: alice, body: {} });
  await host.wait('left');
  await follower.wait('room', (x) => x.room.hostId === bob.user.id);
  assert.equal((await request('a', '/api/library', { session: alice })).status, 401);
  const current = (await request('b', `/api/rooms/${privateRoom.id}`, { session: bob })).body.room;
  assert.equal(current.memberCount, 1);
  assert.equal(current.hostId, bob.user.id);
  assert.equal(current.stateUpdatedAt, anchor);
  assert.equal(current.position, 20);
  assert.equal(current.paused, false);
  await host.close();
  await follower.close();
});
test('a second live session survives another-session logout', async () => {
  const login = await request('a', '/api/auth/login', {
    method: 'POST',
    body: { email: 'bob@example.test', password: 'correct-horse-battery' },
  });
  const other = { user: bob.user, cookie: login.headers.get('set-cookie').split(';')[0] };
  const live = await eventStream('b', other, privateRoom.id);
  await request('a', '/api/auth/logout', { method: 'POST', session: bob, body: {} });
  const current = await request('b', `/api/rooms/${privateRoom.id}`, { session: other });
  assert.equal(current.body.room.joined, true);
  assert.equal(current.body.room.hostId, bob.user.id);
  await live.close();
  bob = other;
});
test('sessions, chat, comments and library records survive both Worker restarts', async () => {
  await Promise.all(streams.map((x) => x.close()));
  await runtime.dispose();
  runtime = await createRuntime({ persist: directory });
  assert.equal((await request('b', '/api/auth/me', { session: bob })).body.user.id, bob.user.id);
  assert.ok(
    (await request('a', '/api/chat')).body.items.some((x) => x.body === 'Across both servers'),
  );
  assert.equal((await request('b', `/api/comments/${media}?unit=2`)).body.items.length, 1);
  assert.equal(
    (
      await sql(runtime, [
        ['SELECT COUNT(*) AS count FROM library WHERE user_id=?', charlie.user.id],
      ])
    )[0].results[0].count,
    5000,
  );
});
