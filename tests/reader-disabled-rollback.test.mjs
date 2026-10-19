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
  disabledRollbackContract,
  rollbackProvider,
} from './reader-disabled-rollback-contract.mjs';

test('compatible disabled Node rollback retains Ara records while hiding all public surfaces', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'yoru-disabled-rollback-'));
  const provider = rollbackProvider();
  const bridge = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const result = await provider.respond(req.url, JSON.parse(body || '{}'));
    res.writeHead(result ? 200 : 404, {
      'content-type': result?.type || 'application/json',
      'x-yoru-cache': 'hit',
    });
    res.end(result?.bytes || JSON.stringify(result?.json || {}));
  });
  await new Promise((done) => bridge.listen(0, '127.0.0.1', done));
  let child, base, sqlite;
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = new Promise((done) => child.once('exit', done));
      child.send('shutdown');
      await exited;
    }
  }
  async function start(flag) {
    child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.hostname !== '127.0.0.1') throw new Error('External network forbidden in rollback fixture');
        return originalFetch(input, init);
      };
      await import('./server/index.js');
    `,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: '0',
          HOST: '127.0.0.1',
          NODE_ENV: 'test',
          CATALOG_OFFLINE: '0',
          DATA_DIR: directory,
          YORU_DB_PATH: join(directory, 'test.sqlite'),
          APP_ORIGIN: '',
          COOKIE_SECURE: 'false',
          READER_EXTENSIONS_ENABLED: flag,
          READER_BRIDGE_URL: `http://127.0.0.1:${bridge.address().port}`,
          READER_BRIDGE_KEY: 'fixture-rollback-key-more-than-32-characters',
          DISCORD_CLIENT_ID: '',
          DISCORD_CLIENT_SECRET: '',
          DISCORD_REDIRECT_URI: '',
          MAL_CLIENT_ID: '',
          MAL_CLIENT_SECRET: '',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    base = null;
    for (let i = 0; i < 200; i++) {
      base = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (base || child.exitCode !== null) break;
      await new Promise((done) => setTimeout(done, 50));
    }
    assert.ok(base, output);
  }
  try {
    await start('1');
    sqlite = new DatabaseSync(join(directory, 'test.sqlite'));
    const db = nodeReaderDb({
      get: (sql, ...values) => sqlite.prepare(sql).get(...values),
      all: (sql, ...values) => sqlite.prepare(sql).all(...values),
      run: (sql, ...values) => sqlite.prepare(sql).run(...values),
      transaction: (fn) => {
        sqlite.exec('BEGIN');
        try {
          const result = fn();
          sqlite.exec('COMMIT');
          return result;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      },
    });
    const request = async (path, { method = 'GET', body, session } = {}) => {
      const result = await fetch(base + path, {
        method,
        headers: {
          origin: base,
          'content-type': 'application/json',
          ...(session ? { cookie: session.cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const bytes = await result.arrayBuffer();
      return {
        status: result.status,
        headers: result.headers,
        body: result.headers.get('content-type')?.includes('application/json')
          ? JSON.parse(Buffer.from(bytes).toString())
          : { bytes: bytes.byteLength },
      };
    };
    await disabledRollbackContract({
      request,
      db,
      provider,
      disable: async () => {
        await stop();
        await start('0');
      },
    });
  } finally {
    sqlite?.close();
    await stop();
    await new Promise((done) => bridge.close(done));
    if (!resolve(directory).startsWith(resolve(join(tmpdir(), 'yoru-disabled-rollback-'))))
      throw new Error('Unexpected disposable directory');
    rmSync(directory, { recursive: true, force: true });
  }
});
