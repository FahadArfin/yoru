import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync(join(tmpdir(), 'yoru-api-'));
let child;
let base;
let output = '';
let alice;
let bob;
let media;
let savedComment;
let publicRoom;
let privateRoom;
const streams = [];

async function start() {
  output = '';
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      CATALOG_OFFLINE: '1',
      DATA_DIR: directory,
      YORU_DB_PATH: join(directory, 'test.sqlite'),
      APP_ORIGIN: '',
      COOKIE_SECURE: 'false',
      DISCORD_CLIENT_ID: '',
      DISCORD_CLIENT_SECRET: '',
      DISCORD_REDIRECT_URI: '',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  for (let i = 0; i < 100; i++) {
    const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) {
      base = match[1];
      return;
    }
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`Server startup timeout: ${output}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.send('shutdown');
  await exited;
}
async function request(path, { method = 'GET', body, session, origin = base, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(session ? { Cookie: session.cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function register(name) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: { name, email: `${name.toLowerCase()}@example.test`, password: 'correct-horse-battery' },
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  return { user: response.body.user, cookie: response.headers.get('set-cookie').split(';')[0] };
}
async function stream(session, roomId) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events${roomId ? `?roomId=${roomId}` : ''}`, {
    headers: session ? { Cookie: session.cookie } : {},
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { events: [], controller, pending: '' };
  streams.push(state);
  state.reading = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        state.pending += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = state.pending.indexOf('\n\n')) >= 0) {
          const message = state.pending.slice(0, boundary);
          state.pending = state.pending.slice(boundary + 2);
          const event = /^event: (.+)$/m.exec(message)?.[1];
          const data = /^data: (.+)$/m.exec(message)?.[1];
          if (event && data) state.events.push({ event, data: JSON.parse(data) });
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    }
  })();
  return state;
}
async function waitEvent(connection, event, predicate = () => true) {
  for (let i = 0; i < 80; i++) {
    const found = connection.events.find((item) => item.event === event && predicate(item.data));
    if (found) return found.data;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Missing SSE ${event}`);
}

before(start);
test('manga discovery and reader counts keep manga separate and require same-origin writes', async () => {
  const first = await request('/api/media/mal-manga-21/read-view', { method: 'POST', body: {} });
  assert.equal(first.status, 200);
  assert.match(first.headers.get('set-cookie'), /HttpOnly/);
  const session = { cookie: first.headers.get('set-cookie').split(';')[0] };
  await request('/api/media/mal-manga-21/read-view', { method: 'POST', body: {}, session });
  assert.equal(
    (await request('/api/media/mal-manga-121496/read-view', { method: 'POST', body: {}, session }))
      .status,
    200,
  );
  const manhwa = await request('/api/manhwa/discovery?mode=trending');
  assert.deepEqual(
    manhwa.body.items.map((item) => [item.id, item.viewers]),
    [['mal-manga-121496', 1]],
  );
  for (const path of ['/api/manhwa/discovery/', '/api/MANHWA/discovery']) {
    const alternate = await request(`${path}?mode=trending&category=MANGA`);
    assert.equal(alternate.body.category, 'MANHWA');
    assert.deepEqual(
      alternate.body.items.map((item) => item.id),
      ['mal-manga-121496'],
    );
  }
  const ranked = await request('/api/manga/discovery?mode=trending');
  assert.deepEqual(
    ranked.body.items.map((item) => [item.id, item.viewers]),
    [['mal-manga-21', 1]],
  );
  assert.equal(
    (await request('/api/media/mal-anime-21/read-view', { method: 'POST', body: {} })).status,
    400,
  );
  assert.equal(
    (
      await request('/api/media/mal-manga-21/read-view', {
        method: 'POST',
        body: {},
        origin: 'https://evil.test',
      })
    ).status,
    403,
  );
  const feed = await request('/api/manga/discovery?mode=new');
  assert.equal(feed.body.state, 'unavailable');
  assert.equal(feed.body.source, 'Kitsu');
  const manhwaFeed = await request('/api/manhwa/discovery?mode=new');
  assert.equal(manhwaFeed.body.category, 'MANHWA');
  assert.equal(manhwaFeed.body.state, 'unavailable');
});
test('anonymous watch views use a private cookie and count one visitor per anime', async () => {
  const first = await request('/api/media/mal-anime-21/view', { method: 'POST', body: {} });
  assert.equal(first.status, 200);
  assert.match(first.headers.get('set-cookie'), /HttpOnly/);
  const session = { cookie: first.headers.get('set-cookie').split(';')[0] };
  assert.equal(
    (await request('/api/media/mal-anime-21/view', { method: 'POST', session, body: {} })).status,
    200,
  );
  await request('/api/media/mal-anime-21/view', { method: 'POST', body: {} });
  const trending = await request('/api/home/discovery?mode=trending');
  assert.equal(trending.body.items[0].viewers, 2);
  assert.equal(JSON.stringify(trending.body).includes('visitor_hash'), false);
  assert.equal(
    (await request('/api/media/mal-manga-21/view', { method: 'POST', body: {} })).status,
    400,
  );
  assert.equal(
    (
      await request('/api/media/mal-anime-21/view', {
        method: 'POST',
        origin: 'https://evil.test',
        body: {},
      })
    ).status,
    403,
  );
});
after(async () => {
  for (const item of streams) item.controller.abort();
  await Promise.allSettled(streams.map((item) => item.reading));
  await stop();
  const target = resolve(directory);
  assert.ok(target.startsWith(resolve(tmpdir())) && target.includes('yoru-api-'));
  rmSync(target, { recursive: true, force: true });
});

test('health, real empty community, and deterministic catalog', async () => {
  assert.equal((await request('/api/health')).body.persistence, 'sqlite');
  assert.deepEqual((await request('/api/online')).body, { count: 0, users: [] });
  assert.deepEqual((await request('/api/chat')).body.items, []);
  assert.deepEqual((await request('/api/community')).body.items, []);
  assert.equal((await request('/api/config')).body.auth.discord, false);
  const catalog = await request('/api/catalog?category=ANIME');
  assert.ok(catalog.body.items.length > 3);
  media = catalog.body.items[0];
  assert.ok(media.id.startsWith('mal-anime-'));
});
test('authentication requires same-origin writes and returns no password/session secrets', async () => {
  assert.equal(
    (
      await request('/api/auth/register', {
        method: 'POST',
        origin: 'https://attacker.test',
        body: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (await request('/api/auth/register', { method: 'POST', origin: null, body: {} })).status,
    403,
  );
  assert.equal((await request('/api/library')).status, 401);
  alice = await register('Alice');
  bob = await register('Bob');
  const me = await request('/api/auth/me', { session: alice });
  assert.equal(me.body.user.name, 'Alice');
  assert.equal(Object.hasOwn(me.body.user, 'password_hash'), false);
  assert.equal(Object.hasOwn(me.body.user, 'token_hash'), false);
  assert.equal((await request('/api/auth/me')).body.user, null);
  assert.equal(
    (
      await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'alice@example.test', password: 'incorrect-password' },
      })
    ).status,
    401,
  );
  const duplicate = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Clone', email: 'ALICE@example.test', password: 'correct-horse-battery' },
  });
  assert.equal(duplicate.status, 409);
  const disk = new DatabaseSync(join(directory, 'test.sqlite'));
  const stored = disk.prepare('SELECT password_hash FROM users WHERE id=?').get(alice.user.id);
  assert.match(stored.password_hash, /^scrypt:/);
  assert.notEqual(stored.password_hash, 'correct-horse-battery');
  const token = disk
    .prepare('SELECT token_hash FROM sessions WHERE user_id=?')
    .get(alice.user.id).token_hash;
  assert.equal(alice.cookie.includes(token), false);
  disk.close();
});
test('library derives ownership from sessions and validates progress and status', async () => {
  const saved = await request(`/api/library/${media.id}`, {
    method: 'PUT',
    session: alice,
    body: { userId: bob.user.id, favorite: true, status: 'watching', progress: 4, score: 9 },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.item.progress, 4);
  assert.equal((await request('/api/library', { session: alice })).body.items.length, 1);
  assert.equal((await request('/api/library', { session: bob })).body.items.length, 0);
  assert.equal(
    (
      await request(`/api/library/${media.id}`, {
        method: 'PUT',
        session: alice,
        body: { progress: -5 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/api/library/${media.id}`, {
        method: 'PUT',
        session: alice,
        body: { status: 'administrator' },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/api/library/${media.id}`, {
        method: 'PUT',
        session: alice,
        body: { favorite: 'false' },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/api/comments/arbitrary-title', {
        method: 'POST',
        session: alice,
        body: { body: 'Invalid media identity' },
      })
    ).status,
    400,
  );
});
test('comment media requires authentication, validates GIFs, and reports independent reaction counts', async () => {
  const content =
    'Great 😂 [[ffz:9:ZrehplaR]]\n![GIF](https://media.giphy.com/media/example/giphy.gif)';
  const endpoint = `/api/comments/${media.id}`;
  assert.equal(
    (await request(endpoint, { method: 'POST', body: { unit: 77, body: content } })).status,
    401,
  );
  assert.equal(
    (
      await request(endpoint, {
        method: 'POST',
        session: alice,
        body: { unit: 77, body: '![GIF](https://evil.test/a.gif)' },
      })
    ).status,
    400,
  );
  const created = await request(endpoint, {
    method: 'POST',
    session: alice,
    body: { unit: 77, body: content, userId: bob.id },
  });
  assert.equal(created.status, 201);
  const id = created.body.comment.id;
  assert.equal(created.body.comment.body, content);
  await request(`/api/comments/${id}/vote`, { method: 'POST', session: alice, body: { value: 1 } });
  const disliked = await request(`/api/comments/${id}/vote`, {
    method: 'POST',
    session: bob,
    body: { value: -1 },
  });
  assert.equal(disliked.body.comment.likes, 1);
  assert.equal(disliked.body.comment.dislikes, 1);
  assert.equal(disliked.body.comment.score, 0);
  assert.equal(disliked.body.comment.viewerVote, -1);
  const changed = await request(`/api/comments/${id}/vote`, {
    method: 'POST',
    session: bob,
    body: { value: 1 },
  });
  assert.equal(changed.body.comment.likes, 2);
  assert.equal(changed.body.comment.dislikes, 0);
  assert.equal((await request(`${endpoint}?unit=78`)).body.items.length, 0);
  await request(`/api/comments/${id}`, { method: 'DELETE', session: alice });
});

test('comments, nested replies, spoilers and idempotent votes stay scoped to their discussion', async () => {
  const first = await request(`/api/comments/${media.id}`, {
    method: 'POST',
    session: alice,
    body: {
      unit: 3,
      body: '<script>literal text</script> — memorable episode',
      spoiler: true,
      userId: bob.user.id,
    },
  });
  assert.equal(first.status, 201);
  savedComment = first.body.comment;
  assert.equal(savedComment.author.id, alice.user.id);
  assert.equal(savedComment.spoiler, true);
  assert.equal(Object.hasOwn(savedComment.author, 'email'), false);
  const reply = await request(`/api/comments/${media.id}`, {
    method: 'POST',
    session: bob,
    body: { unit: 3, parentId: savedComment.id, body: 'That scene was beautifully paced.' },
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.comment.parentId, savedComment.id);
  assert.equal(
    (
      await request(`/api/comments/${media.id}`, {
        method: 'POST',
        session: bob,
        body: { unit: 4, parentId: savedComment.id, body: 'Wrong episode' },
      })
    ).status,
    400,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request(`/api/comments/${savedComment.id}/vote`, {
          method: 'POST',
          session: bob,
          body: { value: 1 },
        })
      ).body.comment.score,
      1,
    );
  assert.equal(
    (
      await request(`/api/comments/${savedComment.id}/vote`, {
        method: 'POST',
        session: bob,
        body: { value: -1 },
      })
    ).body.comment.score,
    -1,
  );
  assert.equal(
    (
      await request(`/api/comments/${savedComment.id}/vote`, {
        method: 'POST',
        session: bob,
        body: { value: 0 },
      })
    ).body.comment.score,
    0,
  );
  assert.equal((await request(`/api/comments/${media.id}?unit=3`)).body.items.length, 2);
  assert.equal((await request(`/api/comments/${media.id}?unit=4`)).body.items.length, 0);
  assert.equal(
    (await request(`/api/comments/${savedComment.id}`, { method: 'DELETE', session: bob })).status,
    404,
  );
});
test('MAL XML preview is read-only and committed imports preserve favorites and isolate ownership', async () => {
  const xml = `<?xml version="1.0"?><myanimelist><myinfo><user_name>Export owner</user_name></myinfo><anime><series_animedb_id>${media.malId}</series_animedb_id><series_title>Imported title</series_title><series_episodes>28</series_episodes><my_watched_episodes>7</my_watched_episodes><my_status>On-Hold</my_status><my_score>8</my_score></anime><manga><manga_mangadb_id>99999999</manga_mangadb_id><manga_title>A newly imported manga</manga_title><my_read_chapters>12</my_read_chapters><my_status>Reading</my_status></manga></myanimelist>`;
  const preview = await request('/api/import/preview', { method: 'POST', body: { xml } });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.total, 2);
  assert.equal(preview.body.items[0].status, 'paused');
  assert.equal((await request('/api/library', { session: alice })).body.items.length, 1);
  assert.equal(
    (await request('/api/import/commit', { method: 'POST', body: { xml } })).status,
    401,
  );
  const committed = await request('/api/import/commit', {
    method: 'POST',
    session: alice,
    body: { xml, userId: bob.user.id },
  });
  assert.equal(committed.status, 200);
  assert.equal(committed.body.imported, 2);
  const items = (await request('/api/library', { session: alice })).body.items;
  const existing = items.find((item) => item.mediaId === media.id);
  assert.equal(existing.favorite, true);
  assert.equal(existing.progress, 7);
  assert.equal(existing.score, 8);
  assert.equal(existing.status, 'paused');
  assert.equal(
    items.find((item) => item.mediaId === 'mal-manga-99999999').media.title,
    'A newly imported manga',
  );
  assert.equal((await request('/api/library', { session: bob })).body.items.length, 0);
  const beforeInvalid = JSON.stringify(items);
  assert.equal(
    (
      await request('/api/import/commit', {
        method: 'POST',
        session: alice,
        body: {
          xml: '<!DOCTYPE x [<!ENTITY boom SYSTEM "file:///etc/passwd">]><myanimelist>&boom;</myanimelist>',
        },
      })
    ).status,
    400,
  );
  assert.equal(
    JSON.stringify((await request('/api/library', { session: alice })).body.items),
    beforeInvalid,
  );
  await request(`/api/library/${media.id}`, {
    method: 'PUT',
    session: alice,
    body: { progress: 4 },
  });
  await request('/api/library/mal-manga-99999999', { method: 'DELETE', session: alice });
});
test('reviews are whole-title records, one per author, with session-owned edits', async () => {
  const original = await request(`/api/reviews/${media.id}`, {
    method: 'POST',
    session: alice,
    body: {
      title: 'A quiet favorite',
      body: 'Exceptional character writing and beautiful direction.',
      rating: 9,
      userId: bob.user.id,
    },
  });
  assert.equal(original.status, 201);
  assert.equal(original.body.review.author.id, alice.user.id);
  const updated = await request(`/api/reviews/${media.id}`, {
    method: 'POST',
    session: alice,
    body: {
      title: 'A favorite',
      body: 'On a second watch, I appreciated the pacing even more.',
      rating: 10,
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.review.id, original.body.review.id);
  assert.equal((await request(`/api/reviews/${media.id}`)).body.items.length, 1);
  assert.equal(
    (await request(`/api/reviews/${original.body.review.id}`, { method: 'DELETE', session: bob }))
      .status,
    404,
  );
  const feed = (await request('/api/community')).body.items;
  assert.ok(feed.some((item) => item.kind === 'review' && item.media.id === media.id));
  const comments = (await request('/api/community?type=comment')).body.items;
  assert.ok(comments.length > 0);
  assert.ok(comments.every((item) => item.kind === 'comment' && item.media));
});
test('live presence and global chat are real, persisted, and broadcast to two clients', async () => {
  const a = await stream(alice);
  const b = await stream(bob);
  const presence = await waitEvent(a, 'online', (data) => data.count === 2);
  assert.equal(presence.users.length, 2);
  assert.equal(
    presence.users.some((user) => 'email' in user),
    false,
  );
  const posted = await request('/api/chat', {
    method: 'POST',
    session: alice,
    body: { body: 'Anyone watching tonight?' },
  });
  assert.equal(posted.status, 201);
  const received = await waitEvent(b, 'chat', (data) => data.message.id === posted.body.message.id);
  assert.equal(received.message.author.id, alice.user.id);
  assert.equal((await request('/api/chat')).body.items.length, 1);
});
test('watch rooms enforce membership, capacity, host authority and shared playback', async () => {
  const created = await request('/api/rooms', {
    method: 'POST',
    session: alice,
    body: {
      name: 'Friday watch club',
      mediaId: media.id,
      type: 'watch',
      capacity: 2,
      visibility: 'public',
    },
  });
  assert.equal(created.status, 201);
  publicRoom = created.body.room;
  assert.equal(publicRoom.hostId, alice.user.id);
  assert.equal(
    (
      await request(`/api/rooms/${publicRoom.id}`, {
        method: 'PATCH',
        session: bob,
        body: { unit: 3 },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request(`/api/rooms/${publicRoom.id}/join`, { method: 'POST', session: bob, body: {} }))
      .status,
    200,
  );
  const carol = await register('Carol');
  assert.equal(
    (
      await request(`/api/rooms/${publicRoom.id}/join`, {
        method: 'POST',
        session: carol,
        body: {},
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/api/rooms/${publicRoom.id}`, {
        method: 'PATCH',
        session: bob,
        body: { hostId: bob.user.id, unit: 3 },
      })
    ).status,
    403,
  );
  const a = await stream(alice, publicRoom.id);
  const b = await stream(bob, publicRoom.id);
  const changed = await request(`/api/rooms/${publicRoom.id}`, {
    method: 'PATCH',
    session: alice,
    body: {
      unit: 3,
      paused: false,
      position: 80,
      sourceUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      sourceKind: 'hls',
    },
  });
  assert.equal(changed.status, 200);
  const event = await waitEvent(b, 'room', (data) => data.room?.unit === 3);
  assert.equal(event.room.position, 80);
  assert.equal(event.room.paused, false);
  assert.equal(
    (
      await request(`/api/rooms/${publicRoom.id}`, {
        method: 'PATCH',
        session: alice,
        body: { sourceUrl: 'javascript:alert(1)' },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/api/rooms/${publicRoom.id}`, {
        method: 'PATCH',
        session: alice,
        body: { sourceUrl: 'http://127.0.0.1/admin' },
      })
    ).status,
    400,
  );
  const chat = await request(`/api/rooms/${publicRoom.id}/chat`, {
    method: 'POST',
    session: bob,
    body: { body: 'Ready for episode three!' },
  });
  await waitEvent(a, 'chat', (data) => data.message.id === chat.body.message.id);
  assert.equal((await request(`/api/rooms/${publicRoom.id}/chat`, { session: carol })).status, 403);
});
test('private rooms require opaque invitations and do not expose chat or invite secrets', async () => {
  const created = await request('/api/rooms', {
    method: 'POST',
    session: alice,
    body: {
      name: 'Private reading circle',
      mediaId: media.id,
      type: 'read',
      visibility: 'private',
    },
  });
  assert.equal(created.status, 201);
  privateRoom = created.body;
  assert.ok(privateRoom.invite.length >= 32);
  await request(`/api/rooms/${privateRoom.room.id}`, {
    method: 'PATCH',
    session: alice,
    body: { sourceUrl: 'https://example.com/invitation-only-video.mp4', sourceKind: 'video' },
  });
  assert.equal((await request(`/api/rooms/${privateRoom.room.id}`, { session: bob })).status, 404);
  const invitedPreview = await request(
    `/api/rooms/${privateRoom.room.id}?invite=${privateRoom.invite}`,
    { session: bob },
  );
  assert.equal(invitedPreview.status, 200);
  assert.equal(invitedPreview.body.room.sourceUrl, '');
  assert.equal(
    (
      await request(`/api/rooms/${privateRoom.room.id}/join`, {
        method: 'POST',
        session: bob,
        body: { invite: 'wrong' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request('/api/rooms', { session: bob })).body.items.some(
      (room) => room.id === privateRoom.room.id,
    ),
    false,
  );
  assert.equal(
    (
      await request(`/api/rooms/${privateRoom.room.id}/join`, {
        method: 'POST',
        session: bob,
        body: { invite: privateRoom.invite },
      })
    ).status,
    200,
  );
  const read = await request(`/api/rooms/${privateRoom.room.id}`, { session: bob });
  assert.equal(read.body.room.sourceUrl, 'https://example.com/invitation-only-video.mp4');
  assert.equal('invite_hash' in read.body.room, false);
  assert.equal('invite' in read.body.room, false);
  assert.equal(
    (
      await request(`/api/rooms/${privateRoom.room.id}/leave`, {
        method: 'POST',
        session: alice,
        body: {},
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/api/rooms/${privateRoom.room.id}`, { session: bob })).body.room.hostId,
    bob.user.id,
  );
  assert.equal(
    (
      await request(`/api/rooms/${privateRoom.room.id}/leave`, {
        method: 'POST',
        session: bob,
        body: {},
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/api/rooms/${privateRoom.room.id}`, { session: alice })).status,
    404,
  );
});
test('logout immediately closes its SSE streams, releases room membership, and transfers host authority', async () => {
  const dave = await register('Dave');
  const eve = await register('Eve');
  const created = await request('/api/rooms', {
    method: 'POST',
    session: dave,
    body: {
      name: 'Session revocation room',
      mediaId: media.id,
      type: 'watch',
      visibility: 'private',
    },
  });
  const roomId = created.body.room.id;
  await request(`/api/rooms/${roomId}/join`, {
    method: 'POST',
    session: eve,
    body: { invite: created.body.invite },
  });
  const d = await stream(dave, roomId);
  const e = await stream(eve, roomId);
  await waitEvent(d, 'snapshot');
  assert.equal(
    (await request('/api/online')).body.users.some((user) => user.id === dave.user.id),
    true,
  );
  assert.equal(
    (await request('/api/auth/logout', { method: 'POST', session: dave, body: {} })).status,
    200,
  );
  let timeout;
  await Promise.race([
    d.reading,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Revoked stream remained open')), 1000);
    }),
  ]);
  clearTimeout(timeout);
  assert.equal(
    (await request('/api/online')).body.users.some((user) => user.id === dave.user.id),
    false,
  );
  const nextHost = await waitEvent(e, 'room', (data) => data.room?.hostId === eve.user.id);
  assert.equal(nextHost.room.memberCount, 1);
  const receivedBefore = d.events.length;
  await request(`/api/rooms/${roomId}/chat`, {
    method: 'POST',
    session: eve,
    body: { body: 'Only the current member receives this message.' },
  });
  await waitEvent(e, 'chat');
  assert.equal(d.events.length, receivedBefore);
  assert.equal((await request(`/api/rooms/${roomId}/chat`, { session: dave })).status, 401);
  await request(`/api/rooms/${roomId}/leave`, { method: 'POST', session: eve, body: {} });
});
test('expired room presence releases capacity and a new participant takes over an absent host', async () => {
  const created = await request('/api/rooms', {
    method: 'POST',
    session: alice,
    body: {
      name: 'Brief reading room',
      mediaId: media.id,
      type: 'read',
      visibility: 'public',
      capacity: 2,
    },
  });
  const id = created.body.room.id;
  const disk = new DatabaseSync(join(directory, 'test.sqlite'));
  disk.prepare('UPDATE room_members SET last_seen=? WHERE room_id=?').run(Date.now() - 120000, id);
  disk.close();
  assert.equal((await request(`/api/rooms/${id}`)).body.room.memberCount, 0);
  const joined = await request(`/api/rooms/${id}/join`, { method: 'POST', session: bob, body: {} });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.room.hostId, bob.user.id);
  assert.equal(joined.body.room.memberCount, 1);
  assert.equal(
    (await request(`/api/rooms/${id}`, { method: 'PATCH', session: alice, body: { unit: 2 } }))
      .status,
    403,
  );
  assert.equal(
    (await request(`/api/rooms/${id}`, { method: 'PATCH', session: bob, body: { unit: 12 } })).body
      .room.unit,
    12,
  );
  await request(`/api/rooms/${id}/leave`, { method: 'POST', session: bob, body: {} });
});
test('records survive server restart; session logout revokes future writes', async () => {
  for (const connection of streams) connection.controller.abort();
  await Promise.allSettled(streams.map((connection) => connection.reading));
  await stop();
  await start();
  assert.equal((await request('/api/library', { session: alice })).body.items[0].progress, 4);
  assert.equal((await request(`/api/comments/${media.id}?unit=3`)).body.items.length, 2);
  assert.equal((await request('/api/chat')).body.items.length, 1);
  assert.equal(
    (await request('/api/auth/logout', { method: 'POST', session: alice, body: {} })).status,
    200,
  );
  assert.equal((await request('/api/auth/me', { session: alice })).body.user, null);
  assert.equal(
    (
      await request('/api/chat', {
        method: 'POST',
        session: alice,
        body: { body: 'Revoked session' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request('/api/chat', {
        method: 'POST',
        session: bob,
        body: { body: 'Still signed in' },
      })
    ).status,
    201,
  );
});
