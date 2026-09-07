import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'yoru-mal-test-'));
process.env.DATA_DIR = directory;
process.env.YORU_DB_PATH = ':memory:';
process.env.CATALOG_OFFLINE = '1';
process.env.NODE_ENV = 'test';
const { db, get, all, run } = await import('../server/db.js');
const { sessionMiddleware, originGuard, hashToken } = await import('../server/auth.js');
const { createMalRouter, encryptMal, decryptMal, malConfiguration } = await import(
  '../server/mal.js'
);
const key = randomBytes(32);
const config = {
  clientId: 'fixture-client',
  clientSecret: 'fixture-secret',
  redirectUri: 'http://127.0.0.1/api/mal/callback',
  key,
  configured: true,
};
const sessions = {
  alice: 'fixture-alice-session-1234567890',
  bob: 'fixture-bob-session-1234567890',
  aliceOther: 'fixture-alice-other-session-1234567890',
};
const calls = [];
let failure = false;
let gate = null;
let gateStarted = false;
let profileGate = null;
let profileStarted = false;
let lastTokenForm;
let base;
let server;
let savedFlow;
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function mockFetch(input, options = {}) {
  const url = new URL(input);
  calls.push({
    origin: url.origin,
    path: url.pathname,
    offset: url.searchParams.get('offset'),
    method: options.method || 'GET',
  });
  if (url.pathname === '/v1/oauth2/token') {
    lastTokenForm = options.body;
    return response({
      access_token: 'fixture-access-token-long',
      refresh_token: 'fixture-refresh-token-long',
      expires_in: 3600,
    });
  }
  if (url.pathname === '/v2/users/@me') {
    if (profileGate) {
      profileStarted = true;
      await profileGate;
    }
    return response({ id: 1234, name: 'ListOwner' });
  }
  if (url.pathname === '/v2/users/@me/animelist') {
    assert.match(options.headers.Authorization, /^Bearer fixture-access-token-long$/);
    if (url.searchParams.get('offset') === '0')
      return response({
        data: [
          {
            node: { id: 21, title: 'One Piece', num_episodes: 1200 },
            list_status: { status: 'watching', num_episodes_watched: 3, score: 9 },
          },
        ],
        paging: { next: 'https://attacker.invalid/steal-token' },
      });
    return response({
      data: [
        {
          node: { id: 52991, title: 'Frieren', num_episodes: 28 },
          list_status: { status: 'completed', num_episodes_watched: 28, score: 10 },
        },
      ],
      paging: {},
    });
  }
  if (url.pathname === '/v2/users/@me/mangalist') {
    if (gate) {
      gateStarted = true;
      await gate;
    }
    if (failure) return response({ error: 'provider failure' }, 503);
    return response({
      data: [
        {
          node: { id: 2, title: 'Berserk', num_chapters: 400 },
          list_status: { status: 'reading', num_chapters_read: 24, score: 0 },
        },
      ],
      paging: {},
    });
  }
  throw new Error('Unexpected remote endpoint');
}
async function request(path, { method = 'GET', body, session = 'alice', stateCookie = '' } = {}) {
  const result = await fetch(`${base}/api/mal${path}`, {
    method,
    redirect: 'manual',
    headers: {
      Origin: base,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(session ? { Cookie: `yoru_session=${sessions[session]}; ${stateCookie}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await result.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { status: result.status, body: data, headers: result.headers };
}
async function authorize() {
  const result = await request('/connect');
  assert.equal(result.status, 302);
  const url = new URL(result.headers.get('location'));
  const state = url.searchParams.get('state');
  const stateCookie = result.headers.get('set-cookie').split(';')[0];
  return { state, stateCookie, url };
}
before(async () => {
  for (const userId of ['alice', 'bob'])
    run(
      'INSERT INTO users(id,name,email,created_at) VALUES(?,?,?,?)',
      userId,
      userId,
      `${userId}@example.test`,
      new Date().toISOString(),
    );
  for (const [label, token] of Object.entries(sessions))
    run(
      'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
      hashToken(token),
      label.startsWith('alice') ? 'alice' : 'bob',
      Date.now() + 3600000,
      Date.now(),
    );
  const app = express();
  app.use(express.json(), originGuard, sessionMiddleware);
  app.use('/api/mal', createMalRouter({ config, fetchImpl: mockFetch, pageDelayMs: 0 }));
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  await new Promise((done) => {
    server = app.listen(0, '127.0.0.1', done);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((done) => server.close(done));
  db.close();
  assert.ok(
    resolve(directory).startsWith(resolve(tmpdir())) && directory.includes('yoru-mal-test-'),
  );
  rmSync(directory, { recursive: true, force: true });
});

test('configuration is disabled without credentials and a valid encryption key', () => {
  const previous = process.env.MAL_TOKEN_ENCRYPTION_KEY;
  process.env.MAL_TOKEN_ENCRYPTION_KEY = 'short';
  assert.equal(malConfiguration().configured, false);
  if (previous === undefined) delete process.env.MAL_TOKEN_ENCRYPTION_KEY;
  else process.env.MAL_TOKEN_ENCRYPTION_KEY = previous;
});
test('encrypted tokens resist tampering, wrong keys, and owner swapping', () => {
  const secret = { accessToken: 'very-secret-token' };
  const ciphertext = encryptMal(secret, key, 'alice');
  assert.equal(ciphertext.includes(secret.accessToken), false);
  assert.deepEqual(decryptMal(ciphertext, key, 'alice'), secret);
  assert.throws(() => decryptMal(ciphertext, key, 'bob'));
  assert.throws(() => decryptMal(ciphertext, randomBytes(32), 'alice'));
  const parts = ciphertext.split('.');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptMal(parts.join('.'), key, 'alice'));
});
test('OAuth requires authentication and binds state plus PKCE to the original session', async () => {
  assert.equal((await request('/connect', { session: null })).status, 401);
  savedFlow = await authorize();
  assert.equal(savedFlow.url.origin, 'https://myanimelist.net');
  assert.equal(savedFlow.url.searchParams.get('code_challenge_method'), 'plain');
  assert.ok(savedFlow.url.searchParams.get('code_challenge').length >= 43);
  assert.equal(
    (
      await request(`/callback?state=${savedFlow.state}&code=fixture-code`, {
        session: 'bob',
        stateCookie: savedFlow.stateCookie,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/callback?state=${savedFlow.state}&code=fixture-code`, {
        session: 'aliceOther',
        stateCookie: savedFlow.stateCookie,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/callback?state=${savedFlow.state}&code=fixture-code`, {
        stateCookie: 'yoru_mal_state=wrong',
      })
    ).status,
    400,
  );
  const result = await request(`/callback?state=${savedFlow.state}&code=fixture-code`, {
    stateCookie: savedFlow.stateCookie,
  });
  assert.equal(result.status, 302);
  assert.equal(result.headers.get('location'), '/settings?mal=connected');
  assert.equal(
    lastTokenForm.get('code_verifier'),
    savedFlow.url.searchParams.get('code_challenge'),
  );
  assert.equal(lastTokenForm.get('client_secret'), 'fixture-secret');
  assert.equal(
    (
      await request(`/callback?state=${savedFlow.state}&code=fixture-code`, {
        stateCookie: savedFlow.stateCookie,
      })
    ).status,
    400,
  );
  const status = (await request('/status')).body;
  assert.equal(status.connected, true);
  assert.equal(status.username, 'ListOwner');
  assert.equal(Object.hasOwn(status, 'tokens_cipher'), false);
  assert.equal((await request('/status', { session: 'bob' })).body.connected, false);
  assert.equal(
    get(
      'SELECT tokens_cipher FROM mal_connections WHERE user_id=?',
      'alice',
    ).tokens_cipher.includes('fixture-access'),
    false,
  );
});
test('manual pull safely paginates, merges both lists, and preserves favorites and local-only titles', async () => {
  run(
    'INSERT INTO library(user_id,media_id,favorite,status,progress,score,updated_at) VALUES(?,?,?,?,?,?,?)',
    'alice',
    'mal-anime-21',
    1,
    'planned',
    0,
    null,
    'before',
  );
  run(
    'INSERT INTO library(user_id,media_id,favorite,status,progress,score,updated_at) VALUES(?,?,?,?,?,?,?)',
    'alice',
    'mal-anime-777',
    0,
    'planned',
    0,
    null,
    'before',
  );
  const result = await request('/sync', { method: 'POST', body: { userId: 'bob' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.imported, 3);
  assert.equal(result.body.anime, 2);
  assert.equal(result.body.manga, 1);
  const entry = get(
    'SELECT * FROM library WHERE user_id=? AND media_id=?',
    'alice',
    'mal-anime-21',
  );
  assert.equal(entry.favorite, 1);
  assert.equal(entry.progress, 3);
  assert.equal(entry.score, 9);
  assert.equal(entry.status, 'watching');
  assert.equal(get('SELECT count(*) AS n FROM library WHERE user_id=?', 'alice').n, 4);
  assert.equal(get('SELECT count(*) AS n FROM library WHERE user_id=?', 'bob').n, 0);
  assert.ok(calls.some((call) => call.path.endsWith('/animelist') && call.offset === '1'));
  assert.equal(
    calls.some((call) => call.origin === 'https://attacker.invalid'),
    false,
  );
  assert.equal(
    calls.some((call) => call.method !== 'GET' && call.path !== '/v1/oauth2/token'),
    false,
  );
});
test('provider failures preserve the complete library and last successful sync timestamp', async () => {
  const before = JSON.stringify(all('SELECT * FROM library ORDER BY media_id'));
  const timestamp = get(
    'SELECT last_synced_at FROM mal_connections WHERE user_id=?',
    'alice',
  ).last_synced_at;
  failure = true;
  assert.equal((await request('/sync', { method: 'POST', body: {} })).status, 502);
  failure = false;
  assert.equal(JSON.stringify(all('SELECT * FROM library ORDER BY media_id')), before);
  assert.equal(
    get('SELECT last_synced_at FROM mal_connections WHERE user_id=?', 'alice').last_synced_at,
    timestamp,
  );
});
test('expired tokens refresh server-side before list retrieval', async () => {
  const connection = get('SELECT * FROM mal_connections WHERE user_id=?', 'alice');
  const tokens = decryptMal(connection.tokens_cipher, key, 'alice');
  tokens.expiresAt = 0;
  run(
    'UPDATE mal_connections SET tokens_cipher=? WHERE user_id=?',
    encryptMal(tokens, key, 'alice'),
    'alice',
  );
  assert.equal((await request('/sync', { method: 'POST', body: {} })).status, 200);
  assert.equal(lastTokenForm.get('grant_type'), 'refresh_token');
  assert.equal(lastTokenForm.get('refresh_token'), 'fixture-refresh-token-long');
});
test('disconnect cancels an in-flight pull without changing the library', async () => {
  const before = JSON.stringify(all('SELECT * FROM library ORDER BY media_id'));
  let release;
  gate = new Promise((done) => {
    release = done;
  });
  gateStarted = false;
  const pulling = request('/sync', { method: 'POST', body: {} });
  for (let i = 0; !gateStarted && i < 50; i++) await new Promise((done) => setTimeout(done, 10));
  assert.equal(gateStarted, true);
  assert.equal((await request('/disconnect', { method: 'POST', body: {} })).status, 200);
  release();
  gate = null;
  assert.equal((await pulling).status, 409);
  assert.equal((await request('/status')).body.connected, false);
  assert.equal(JSON.stringify(all('SELECT * FROM library ORDER BY media_id')), before);
  assert.equal((await request('/sync', { method: 'POST', body: {} })).status, 409);
});
test('disconnect also cancels an OAuth callback already exchanging credentials', async () => {
  const flow = await authorize();
  let release;
  profileGate = new Promise((done) => {
    release = done;
  });
  profileStarted = false;
  const completing = request(`/callback?state=${flow.state}&code=fixture-code`, {
    stateCookie: flow.stateCookie,
  });
  for (let i = 0; !profileStarted && i < 50; i++) await new Promise((done) => setTimeout(done, 10));
  assert.equal(profileStarted, true);
  assert.equal(
    (await request(`/callback?state=${flow.state}&code=replay`, { stateCookie: flow.stateCookie }))
      .status,
    400,
  );
  await request('/disconnect', { method: 'POST', body: {} });
  release();
  profileGate = null;
  assert.equal((await completing).status, 409);
  assert.equal((await request('/status')).body.connected, false);
});
