import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
test('Node reader context routes enforce origin and guest CAS with only session identity', async () => {
  process.env.YORU_DB_PATH = ':memory:';
  process.env.CATALOG_OFFLINE = '1';
  const { catalogRouter } = await import('../server/catalog.js');
  const { originGuard, sessionMiddleware } = await import('../server/auth.js');
  const { db } = await import('../server/db.js');
  const app = express();
  app.use(express.json());
  app.use('/api', originGuard, sessionMiddleware, catalogRouter);
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: error.expose ? error.message : 'Unavailable' }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${origin}/api/reader/context?destination=yoru&userId=other`);
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Secure/);
    const body = {
      destination: 'yoru',
      selection: { modes: { yoru: 'core' } },
      expectedRevision: 0,
    };
    const post = (originHeader) =>
      fetch(`${origin}/api/reader/context`, {
        method: 'POST',
        headers: { origin: originHeader, cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    assert.equal((await post('http://attacker.test')).status, 403);
    assert.equal((await post(origin)).status, 200);
    assert.equal((await post(origin)).status, 409);
    assert.equal(
      (
        await (
          await fetch(`${origin}/api/reader/context?destination=yoru`, { headers: { cookie } })
        ).json()
      ).revision,
      1,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
