import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, migrate, sql } from './harness.mjs';

const directory = mkdtempSync(join(tmpdir(), 'yoru-chatgpt-'));
let runtime;
before(async () => {
  runtime = await createRuntime({ persist: directory });
  await migrate(runtime);
});
after(async () => {
  await runtime?.dispose();
  rmSync(directory, { recursive: true, force: true });
});
const cookieOf = (response) =>
  (response.headers.getSetCookie?.() || [response.headers.get('set-cookie')])
    .filter(Boolean)
    .map((s) => s.split(';')[0])
    .filter((s) => !s.endsWith('='))
    .join('; ');
async function raw(path, { method = 'GET', body, cookie = '', headers = {}, instance = 'a' } = {}) {
  return runtime.dispatchFetch(`http://${instance}.test${path}`, {
    method,
    redirect: 'manual',
    headers: {
      origin: `http://${instance}.test`,
      cookie,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function json(path, options) {
  const r = await raw(path, options);
  return { status: r.status, body: await r.json(), cookie: cookieOf(r), headers: r.headers };
}
async function start(cookie = '', link = false) {
  const r = await raw(
    link ? '/api/auth/chatgpt/connect' : '/api/auth/chatgpt/start?returnTo=%2Flibrary',
    { cookie, ...(link ? { method: 'POST', body: { returnTo: '/settings' } } : {}) },
  );
  const url = link ? (await r.json()).url : r.headers.get('location');
  assert.match(url, /^\/signin-with-chatgpt\?/);
  const callback = new URL(url, 'https://test').searchParams.get('return_to');
  return { callback, cookie: [cookie, cookieOf(r)].filter(Boolean).join('; ') };
}
async function complete(flow, id, email, extra = {}) {
  const r = await raw(flow.callback, {
    cookie: flow.cookie,
    headers: { 'oai-authenticated-user-id': id, 'oai-authenticated-user-email': email, ...extra },
    instance: 'b',
  });
  return { status: r.status, location: r.headers.get('location'), cookie: cookieOf(r) };
}
test('ChatGPT sign-in uses stable identity, explicit state, private account data and revocable sessions', async () => {
  const flow = await start();
  const result = await complete(flow, 'sites-user-one', 'one@example.test');
  assert.equal(result.location, '/library');
  const me = await json('/api/auth/me', { cookie: result.cookie });
  assert.equal(me.body.user.chatgptConnected, true);
  assert.equal(me.body.user.name, 'Yoru reader');
  assert.equal(me.body.user.email, 'one@example.test');
  assert.equal(Object.hasOwn(me.body.user, 'chatgpt_id'), false);
  assert.equal(me.headers.get('cache-control'), 'no-store');
  const cookie = result.cookie;
  const saved = await json('/api/library/mal-anime-52991', {
    method: 'PUT',
    cookie,
    body: { favorite: true, status: 'completed', progress: 28, score: 9 },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const review = await json('/api/reviews/mal-anime-52991', {
    method: 'POST',
    cookie,
    body: {
      rating: 9,
      title: 'Saved review',
      body: 'This review belongs to the same account.',
      spoiler: false,
    },
  });
  assert.equal(review.status, 201, JSON.stringify(review.body));
  const comment = await json('/api/comments/mal-anime-52991', {
    method: 'POST',
    cookie,
    body: { unit: 2, body: 'Saved discussion' },
  });
  assert.equal(comment.status, 201);
  assert.equal(
    (
      await json(`/api/comments/${comment.body.comment.id}/vote`, {
        method: 'POST',
        cookie,
        body: { value: -1 },
      })
    ).status,
    200,
  );
  const renamed = await json('/api/auth/profile', {
    method: 'PATCH',
    cookie,
    body: { name: 'My public name' },
  });
  assert.equal(renamed.body.user.name, 'My public name');
  const logout = await json('/api/auth/logout', { method: 'POST', cookie, body: {} });
  assert.match(logout.body.redirect, /^\/signout-with-chatgpt\?/);
  assert.equal((await json('/api/auth/me', { cookie })).body.user, null);
  assert.equal((await json('/api/library', { cookie })).status, 401);
  const again = await complete(await start(), 'sites-user-one', 'changed@example.test');
  const user = (await json('/api/auth/me', { cookie: again.cookie })).body.user;
  assert.equal(user.id, me.body.user.id);
  assert.equal(user.name, 'My public name');
  const library = await json('/api/library', { cookie: again.cookie });
  assert.equal(library.body.items.find((x) => x.mediaId === 'mal-anime-52991').status, 'completed');
  const comments = await json('/api/comments/mal-anime-52991?unit=2', { cookie: again.cookie });
  assert.equal(comments.body.items.find((x) => x.id === comment.body.comment.id).viewerVote, -1);
  assert.match((await complete(flow, 'sites-user-one', 'one@example.test')).location, /authError/);
  const other = await complete(await start(), 'sites-user-two', 'two@example.test');
  assert.equal((await json('/api/library', { cookie: other.cookie })).body.items.length, 0);
});
test('existing password accounts explicitly link without losing data or email-based account takeover', async () => {
  const original = await json('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Existing member',
      email: 'existing@example.test',
      password: 'correct-horse-battery',
    },
  });
  assert.equal(original.status, 201);
  await json('/api/library/mal-anime-52991', {
    method: 'PUT',
    cookie: original.cookie,
    body: { favorite: true, status: 'watching', progress: 4 },
  });
  const collision = await complete(await start(), 'existing-subject', 'existing@example.test');
  assert.match(decodeURIComponent(collision.location), /password.*connect ChatGPT/);
  const linked = await complete(
    await start(original.cookie, true),
    'existing-subject',
    'existing@example.test',
  );
  assert.equal(linked.location, '/settings');
  const originalMe = (await json('/api/auth/me', { cookie: original.cookie })).body.user;
  assert.equal(originalMe.chatgptConnected, true);
  await json('/api/auth/logout', { method: 'POST', cookie: original.cookie, body: {} });
  const next = await complete(await start(), 'existing-subject', 'existing@example.test');
  assert.equal((await json('/api/auth/me', { cookie: next.cookie })).body.user.id, originalMe.id);
  assert.equal((await json('/api/library', { cookie: next.cookie })).body.items[0].favorite, true);
  const password = await json('/api/auth/login', {
    method: 'POST',
    body: { email: 'existing@example.test', password: 'correct-horse-battery' },
  });
  assert.equal(password.body.user.id, originalMe.id);
  const conflict = await complete(
    await start(password.cookie, true),
    'sites-user-two',
    'two@example.test',
  );
  assert.match(decodeURIComponent(conflict.location), /already connected/);
  const expired = await start(password.cookie, true);
  await json('/api/auth/logout', { method: 'POST', cookie: password.cookie, body: {} });
  assert.match(
    decodeURIComponent((await complete(expired, 'new-subject', 'new@example.test')).location),
    /session changed/,
  );
});
test('callbacks reject missing identity, forged state, expired state and unsafe return paths', async () => {
  assert.equal(
    (
      await json('/api/auth/me', {
        headers: {
          'oai-authenticated-user-id': 'forged',
          'oai-authenticated-user-email': 'one@example.test',
        },
      })
    ).body.user,
    null,
  );
  const flow = await start();
  assert.match(
    (await raw(flow.callback, { cookie: flow.cookie })).headers.get('location'),
    /authError/,
  );
  const fresh = await start();
  assert.match(
    (await complete({ ...fresh, cookie: '' }, 'missing-cookie', 'new@example.test')).location,
    /authError/,
  );
  await sql(runtime, [['UPDATE chatgpt_states SET expires_at=0']]);
  assert.match((await complete(fresh, 'expired', 'new@example.test')).location, /authError/);
  const blocked = await raw('/api/auth/chatgpt/start?returnTo=https%3A%2F%2Fevil.test');
  const callback = new URL(blocked.headers.get('location'), 'https://test').searchParams.get(
    'return_to',
  );
  const result = await complete(
    { callback, cookie: cookieOf(blocked) },
    'safe-redirect',
    'safe@example.test',
  );
  assert.equal(result.location, '/settings');
  assert.equal((await json('/api/auth/chatgpt/connect', { method: 'POST', body: {} })).status, 401);
});
test('reader bookmarks and read markers persist across login methods and do not overwrite each other', async () => {
  const session = await complete(await start(), 'marker-user', 'markers@example.test');
  const owner = (await json('/api/auth/me', { cookie: session.cookie })).body.user.id;
  const endpoint = '/api/reader-markers/mal-manga-121496';
  const base = { owner, chapterId: 'local:1:en:Files', updatedAt: Date.now() - 100 };
  let response = await json(endpoint, {
    method: 'PUT',
    cookie: session.cookie,
    body: { ...base, bookmark: 12 },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  response = await json(endpoint, {
    method: 'PUT',
    cookie: session.cookie,
    body: { ...base, updatedAt: base.updatedAt + 1, read: true },
  });
  assert.equal(response.body.chapters[base.chapterId].bookmark, 12);
  assert.equal(response.body.chapters[base.chapterId].read, true);
  response = await json(endpoint, {
    method: 'PUT',
    cookie: session.cookie,
    body: { ...base, updatedAt: base.updatedAt - 1, bookmark: 1 },
  });
  assert.equal(response.body.chapters[base.chapterId].bookmark, 12);
  const next = await complete(await start(), 'marker-user', 'markers@example.test');
  assert.equal(
    (await json(endpoint, { cookie: next.cookie })).body.chapters[base.chapterId].read,
    true,
  );
  response = await json(endpoint, {
    method: 'PUT',
    cookie: next.cookie,
    body: { ...base, updatedAt: base.updatedAt + 2, bookmark: null },
  });
  assert.equal(response.body.chapters[base.chapterId].bookmark, null);
  assert.equal(
    (
      await json(endpoint, {
        method: 'PUT',
        cookie: next.cookie,
        body: { ...base, owner: 'someone-else', bookmark: 1 },
      })
    ).status,
    409,
  );
  assert.equal((await json(endpoint)).status, 401);
  const other = await complete(await start(), 'marker-other', 'marker-other@example.test');
  assert.deepEqual((await json(endpoint, { cookie: other.cookie })).body.chapters, {});
});
