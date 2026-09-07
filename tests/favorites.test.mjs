import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'yoru-favorites-test-'));
process.env.YORU_DB_PATH = ':memory:';
process.env.DATA_DIR = directory;
process.env.CATALOG_OFFLINE = '1';
process.env.NODE_ENV = 'test';
const { db, get, all, run } = await import('../server/db.js');
const { sessionMiddleware, originGuard, hashToken } = await import('../server/auth.js');
const { createFavoritesRouter, normalizePublicFavorites } = await import('../server/favorites.js');
const tokens = {
  alice: 'alice-session-1234567890',
  bob: 'bob-session-1234567890',
  aliceOther: 'alice-other-session-1234567890',
};
let base;
let server;
let remoteFailure = false;
let preview;
const calls = [];
async function mockFetch(url, options) {
  calls.push({ url, options });
  if (remoteFailure) return new Response('{}', { status: 503 });
  return new Response(
    JSON.stringify({
      data: {
        anime: [
          { mal_id: 21, title: 'One Piece' },
          { mal_id: 52991, title: 'Frieren' },
          { mal_id: 21, title: 'One Piece' },
        ],
        manga: [{ mal_id: 2, title: 'Berserk' }],
      },
    }),
    { status: 200 },
  );
}
async function request(path, body, session = 'alice') {
  const response = await fetch(`${base}/api/import/favorites${path}`, {
    method: 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(session ? { Cookie: `yoru_session=${tokens[session]}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  for (const userId of ['alice', 'bob'])
    run(
      'INSERT INTO users(id,name,created_at) VALUES(?,?,?)',
      userId,
      userId,
      new Date().toISOString(),
    );
  for (const [label, token] of Object.entries(tokens))
    run(
      'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
      hashToken(token),
      label.startsWith('alice') ? 'alice' : 'bob',
      Date.now() + 3600000,
      Date.now(),
    );
  const app = express();
  app.use(express.json(), originGuard, sessionMiddleware);
  app.use('/api/import/favorites', createFavoritesRouter({ fetchImpl: mockFetch, offline: false }));
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
    resolve(directory).startsWith(resolve(tmpdir())) && directory.includes('yoru-favorites-test-'),
  );
  rmSync(directory, { recursive: true, force: true });
});
test('favorites preview requires login and a constrained username', async () => {
  assert.equal((await request('/preview', { username: 'Public_User' }, null)).status, 401);
  for (const username of ['../admin', 'https://attacker.test', 'a?token=secret', 'a'.repeat(33)])
    assert.equal((await request('/preview', { username })).status, 400);
  assert.equal(calls.length, 0);
});
test('preview fetches only the fixed public endpoint without credentials and does not mutate the library', async () => {
  const result = await request('/preview', { username: 'Public_User' });
  assert.equal(result.status, 200);
  preview = result.body;
  assert.equal(preview.total, 3);
  assert.equal(preview.anime, 2);
  assert.equal(preview.manga, 1);
  assert.ok(preview.previewToken.length >= 43);
  assert.equal(get('SELECT count(*) AS n FROM library').n, 0);
  assert.equal(calls[0].url, 'https://api.jikan.moe/v4/users/Public_User/favorites');
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json' });
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});
test('commit binds to the exact session, prevents replay, and preserves existing progress/status/score', async () => {
  run(
    'INSERT INTO library(user_id,media_id,favorite,status,progress,score,updated_at) VALUES(?,?,?,?,?,?,?)',
    'alice',
    'mal-anime-21',
    0,
    'watching',
    100,
    9,
    'before',
  );
  assert.equal(
    (await request('/commit', { previewToken: preview.previewToken }, 'bob')).status,
    400,
  );
  assert.equal(
    (await request('/commit', { previewToken: preview.previewToken }, 'aliceOther')).status,
    400,
  );
  const result = await request('/commit', {
    previewToken: preview.previewToken,
    userId: 'bob',
    items: [{ mediaId: 'mal-anime-999999' }],
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.imported, 3);
  const existing = get(
    'SELECT * FROM library WHERE user_id=? AND media_id=?',
    'alice',
    'mal-anime-21',
  );
  assert.equal(existing.favorite, 1);
  assert.equal(existing.progress, 100);
  assert.equal(existing.status, 'watching');
  assert.equal(existing.score, 9);
  const fresh = get('SELECT * FROM library WHERE user_id=? AND media_id=?', 'alice', 'mal-manga-2');
  assert.equal(fresh.favorite, 1);
  assert.equal(fresh.status, 'planned');
  assert.equal(fresh.progress, 0);
  assert.equal(get('SELECT count(*) AS n FROM library WHERE user_id=?', 'bob').n, 0);
  assert.equal((await request('/commit', { previewToken: preview.previewToken })).status, 400);
});
test('provider failure and malformed favorite data cannot alter the library', async () => {
  const before = JSON.stringify(all('SELECT * FROM library ORDER BY media_id'));
  remoteFailure = true;
  const response = await request('/preview', { username: 'Unavailable_User' });
  assert.equal(response.status, 502);
  assert.match(response.body.error, /unchanged/);
  remoteFailure = false;
  assert.equal(JSON.stringify(all('SELECT * FROM library ORDER BY media_id')), before);
  assert.throws(() =>
    normalizePublicFavorites({
      data: { anime: [{ mal_id: '../oops', title: 'Invalid' }], manga: [] },
    }),
  );
  assert.throws(() =>
    normalizePublicFavorites({
      data: { anime: Array(1001).fill({ mal_id: 21, title: 'Title' }), manga: [] },
    }),
  );
});
test('logout invalidates an outstanding favorites preview', async () => {
  const result = await request('/preview', { username: 'Public_User' });
  assert.equal(result.status, 200);
  run('DELETE FROM sessions WHERE token_hash=?', hashToken(tokens.alice));
  assert.equal((await request('/commit', { previewToken: result.body.previewToken })).status, 401);
  assert.equal(
    (await request('/commit', { previewToken: result.body.previewToken }, 'aliceOther')).status,
    400,
  );
});
