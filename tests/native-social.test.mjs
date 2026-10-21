import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nodeReaderDb } from '../server/reader-db.js';
import {
  nativeSocialContract,
  socialProvider,
  socialSeeds,
  socialEventStream,
} from './native-social-contract.mjs';

test('Node native social destinations, exact chapters, rooms and activity', async () => {
  const provider = socialProvider(),
    directory = mkdtempSync(join(tmpdir(), 'yoru-native-social-'));
  const bridge = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const result = await provider.respond(req.url, JSON.parse(body || '{}'));
    res.writeHead(result ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result || {}));
  });
  await new Promise((done) => bridge.listen(0, '127.0.0.1', done));
  const child = spawn(
    process.execPath,
    ['--import', './tests/native-social-hydration-register.mjs', 'server/index.js'],
    {
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
        READER_EXTENSIONS_ENABLED: '1',
        READER_BRIDGE_URL: `http://127.0.0.1:${bridge.address().port}`,
        SOCIAL_HYDRATION_BARRIER: `http://127.0.0.1:${bridge.address().port}/__test/social-hydration`,
        READER_BRIDGE_KEY: 'fixture-native-social-key-more-than-32-characters',
        DISCORD_CLIENT_ID: '',
        DISCORD_CLIENT_SECRET: '',
        DISCORD_REDIRECT_URI: '',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let output = '',
    base,
    sqlite;
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  try {
    for (let i = 0; i < 100; i++) {
      base = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (base) break;
      if (child.exitCode !== null) throw new Error(output);
      await new Promise((done) => setTimeout(done, 50));
    }
    assert.ok(base, output);
    sqlite = new DatabaseSync(join(directory, 'test.sqlite'));
    const db = nodeReaderDb({
      get: (s, ...v) => sqlite.prepare(s).get(...v),
      all: (s, ...v) => sqlite.prepare(s).all(...v),
      run: (s, ...v) => sqlite.prepare(s).run(...v),
      transaction: (fn) => {
        sqlite.exec('BEGIN');
        try {
          const r = fn();
          sqlite.exec('COMMIT');
          return r;
        } catch (e) {
          sqlite.exec('ROLLBACK');
          throw e;
        }
      },
    });
    const request = async (path, { method = 'GET', body, session } = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          origin: base,
          'content-type': 'application/json',
          ...(session ? { cookie: session.cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json(), headers: response.headers };
    };
    const register = async (name) => {
      const r = await request('/api/auth/register', {
        method: 'POST',
        body: { name, email: `${name}@fixture.test`, password: 'correct-horse-battery' },
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return { user: r.body.user, cookie: r.headers.get('set-cookie').split(';')[0] };
    };
    await nativeSocialContract({
      request,
      register,
      db,
      provider,
      ...socialSeeds(db, provider),
      events: async (path, session) =>
        socialEventStream(await fetch(base + path, { headers: { cookie: session.cookie } })),
    });
  } finally {
    sqlite?.close();
    if (child.exitCode === null) {
      const exited = new Promise((done) => child.once('exit', done));
      child.send('shutdown');
      await exited;
    }
    await new Promise((done) => bridge.close(done));
    if (!resolve(directory).startsWith(resolve(join(tmpdir(), 'yoru-native-social-'))))
      throw new Error('Unexpected test directory');
    rmSync(directory, { recursive: true, force: true });
  }
});
