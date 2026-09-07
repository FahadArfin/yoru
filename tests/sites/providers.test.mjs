import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { createRuntime, migrate, sql } from './harness.mjs';
import { Response } from 'miniflare';

let runtime,
  session,
  userId,
  tokenCalls = 0,
  mode = 'normal',
  release,
  started;
const seen = [];
const key = randomBytes(32).toString('base64');
async function provider(request) {
  const url = new URL(request.url);
  seen.push(url.href);
  if (url.hostname === 'api.jikan.moe' && url.pathname === '/v4/users/PublicUser/favorites')
    return Response.json({
      data: {
        anime: [{ mal_id: 52991, title: 'Frieren' }],
        manga: [{ mal_id: 121496, title: 'Solo Leveling' }],
      },
    });
  if (url.hostname === 'myanimelist.net' && url.pathname === '/v1/oauth2/token') {
    tokenCalls++;
    if (mode === 'block-token') {
      started?.();
      await new Promise((done) => (release = done));
    }
    return Response.json({
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expires_in: 3600,
    });
  }
  if (url.hostname === 'api.myanimelist.net') {
    assert.equal(request.headers.get('authorization'), 'Bearer test-access-token');
    if (url.pathname === '/v2/users/@me') return Response.json({ id: 123, name: 'ConnectedUser' });
    if (mode === 'block-sync') {
      started?.();
      await new Promise((done) => (release = done));
      mode = 'normal';
    }
    if (mode === 'failure') return new Response('Unavailable', { status: 503 });
    const anime = url.pathname.endsWith('animelist');
    return Response.json({
      data: [
        {
          node: {
            id: anime ? 52991 : 121496,
            title: anime ? 'Frieren' : 'Solo Leveling',
            num_episodes: 28,
            num_chapters: 200,
          },
          list_status: {
            status: anime ? 'watching' : 'reading',
            num_episodes_watched: 5,
            num_chapters_read: 12,
            score: 8,
          },
        },
      ],
      paging: {},
    });
  }
  return new Response('No test provider at this URL', { status: 404 });
}
async function raw(instance, path, { method = 'GET', body, cookie = session } = {}) {
  return runtime.dispatchFetch(`http://${instance}.test${path}`, {
    method,
    redirect: 'manual',
    headers: {
      origin: `http://${instance}.test`,
      ...(cookie ? { cookie } : {}),
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function request(instance, path, options) {
  const r = await raw(instance, path, options);
  return { status: r.status, body: await r.json(), headers: r.headers };
}
async function startConnect() {
  const response = await raw('a', '/api/mal/connect');
  assert.equal(response.status, 302);
  const url = new URL(response.headers.get('location'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'plain');
  assert.ok(url.searchParams.get('code_challenge').length >= 43);
  return {
    state: url.searchParams.get('state'),
    cookie: session + '; ' + response.headers.get('set-cookie').split(';')[0],
  };
}
async function connect() {
  const flow = await startConnect();
  const response = await raw('b', `/api/mal/callback?state=${flow.state}&code=authcode`, {
    cookie: flow.cookie,
  });
  assert.equal(response.status, 302, await response.text());
}
before(async () => {
  runtime = await createRuntime({
    provider,
    bindings: {
      CATALOG_OFFLINE: '0',
      MAL_CLIENT_ID: 'test-client',
      MAL_CLIENT_SECRET: 'test-secret',
      MAL_REDIRECT_URI: 'https://a.test/api/mal/callback',
      MAL_TOKEN_ENCRYPTION_KEY: key,
    },
  });
  await migrate(runtime);
  const result = await request('a', '/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Provider Tester',
      email: 'provider@example.test',
      password: 'correct-horse-battery',
    },
  });
  assert.equal(result.status, 201);
  session = result.headers.get('set-cookie').split(';')[0];
  userId = result.body.user.id;
});
after(async () => {
  release?.();
  await runtime?.dispose();
});

test('public favorites preview crosses Workers and commits without changing existing progress', async () => {
  await sql(runtime, [
    [
      'INSERT INTO library(user_id,media_id,favorite,status,progress,score,updated_at) VALUES(?,?,?,?,?,?,?)',
      userId,
      'mal-anime-52991',
      0,
      'watching',
      17,
      9,
      new Date().toISOString(),
    ],
  ]);
  const preview = await request('a', '/api/import/favorites/preview', {
    method: 'POST',
    body: { username: 'PublicUser' },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.total, 2);
  const result = await request('b', '/api/import/favorites/commit', {
    method: 'POST',
    body: { previewToken: preview.body.previewToken },
  });
  assert.equal(result.status, 200);
  const row = (
    await sql(runtime, [
      ['SELECT * FROM library WHERE user_id=? AND media_id=?', userId, 'mal-anime-52991'],
    ])
  )[0].results[0];
  assert.equal(row.favorite, 1);
  assert.equal(row.progress, 17);
  assert.equal(row.score, 9);
});
test('MAL callback is claimed exactly once across Workers and stores only encrypted credentials', async () => {
  const flow = await startConnect(),
    calls = tokenCalls;
  const responses = await Promise.all(
    ['a', 'b'].map((instance) =>
      raw(instance, `/api/mal/callback?state=${flow.state}&code=authcode`, { cookie: flow.cookie }),
    ),
  );
  assert.deepEqual(responses.map((x) => x.status).sort(), [302, 400]);
  assert.equal(tokenCalls, calls + 1);
  const status = (await request('b', '/api/mal/status')).body;
  assert.equal(status.connected, true);
  assert.equal(status.username, 'ConnectedUser');
  const stored = (
    await sql(runtime, [['SELECT tokens_cipher FROM mal_connections WHERE user_id=?', userId]])
  )[0].results[0].tokens_cipher;
  assert.equal(stored.includes('test-access-token'), false);
  assert.match(stored, /^v1\./);
});
test('MAL sync persists both formats and a provider failure preserves the previous library', async () => {
  const result = await request('b', '/api/mal/sync', { method: 'POST', body: {} });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.imported, 2);
  const before = await sql(runtime, [
    ['SELECT * FROM library WHERE user_id=? ORDER BY media_id', userId],
    ['SELECT last_synced_at FROM mal_connections WHERE user_id=?', userId],
  ]);
  assert.equal(before[0].results[0].favorite, 1);
  assert.equal(before[0].results[0].progress, 5);
  mode = 'failure';
  const failed = await request('a', '/api/mal/sync', { method: 'POST', body: {} });
  mode = 'normal';
  assert.equal(failed.status, 502);
  const after = await sql(runtime, [
    ['SELECT * FROM library WHERE user_id=? ORDER BY media_id', userId],
    ['SELECT last_synced_at FROM mal_connections WHERE user_id=?', userId],
  ]);
  assert.deepEqual(
    after.map((x) => x.results),
    before.map((x) => x.results),
  );
});
test('disconnect fences a sync already waiting on the provider', async () => {
  mode = 'block-sync';
  const reached = new Promise((done) => (started = done));
  const pending = request('a', '/api/mal/sync', { method: 'POST', body: {} });
  await reached;
  const before = (
    await sql(runtime, [['SELECT * FROM library WHERE user_id=? ORDER BY media_id', userId]])
  )[0].results;
  await request('b', '/api/mal/disconnect', { method: 'POST', body: {} });
  release();
  assert.equal((await pending).status, 409);
  assert.deepEqual(
    (await sql(runtime, [['SELECT * FROM library WHERE user_id=? ORDER BY media_id', userId]]))[0]
      .results,
    before,
  );
  assert.equal((await request('b', '/api/mal/status')).body.connected, false);
});
test('disconnect cancels a callback already exchanging tokens', async () => {
  const flow = await startConnect();
  mode = 'block-token';
  const reached = new Promise((done) => (started = done));
  const pending = raw('a', `/api/mal/callback?state=${flow.state}&code=authcode`, {
    cookie: flow.cookie,
  });
  await reached;
  await request('b', '/api/mal/disconnect', { method: 'POST', body: {} });
  mode = 'normal';
  release();
  assert.equal((await pending).status, 409);
  assert.equal((await request('a', '/api/mal/status')).body.connected, false);
});
test('logout fences a mutation already authenticated on another Worker', async () => {
  await connect();
  const before = (
    await sql(runtime, [['SELECT * FROM library WHERE user_id=? ORDER BY media_id', userId]])
  )[0].results;
  mode = 'block-sync';
  const reached = new Promise((done) => (started = done));
  const pending = request('a', '/api/mal/sync', { method: 'POST', body: {} });
  await reached;
  await request('b', '/api/auth/logout', { method: 'POST', body: {} });
  release();
  assert.equal((await pending).status, 401);
  assert.deepEqual(
    (await sql(runtime, [['SELECT * FROM library WHERE user_id=? ORDER BY media_id', userId]]))[0]
      .results,
    before,
  );
});
