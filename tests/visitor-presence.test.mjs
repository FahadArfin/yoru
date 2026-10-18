import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  presenceSchema,
  touchVisitor,
  visitorSnapshot,
  PRESENCE_WINDOW,
} from '../server/visitor-presence.js';

test('presence deduplicates browsers and members, expires, and never exposes guest or session identities', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,avatar TEXT);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER);
    INSERT INTO users VALUES('alice','Alice','');
    INSERT INTO sessions VALUES('secret','alice',9999999);`);
  sqlite.exec(presenceSchema);
  const db = Object.fromEntries(
    ['get', 'all', 'run'].map((method) => [
      method,
      (sql, ...values) => sqlite.prepare(sql)[method](...values),
    ]),
  );
  try {
    const first = await touchVisitor(
      db,
      { activity: 'watching', userId: 'alice' },
      '',
      null,
      null,
      1000,
    );
    assert.equal(first.online.guests, 1);
    assert.equal(first.online.registered, 0);
    assert.equal(first.online.watching, 1);
    const again = await touchVisitor(db, { activity: 'reading' }, first.visitor, null, null, 2000);
    assert.equal(again.online.count, 1);
    assert.equal(again.online.reading, 1);
    await touchVisitor(
      db,
      { activity: 'watching' },
      first.visitor,
      { id: 'alice' },
      'secret',
      3000,
    );
    const secondDevice = await touchVisitor(
      db,
      { activity: 'reading' },
      '',
      { id: 'alice' },
      'secret',
      4000,
    );
    assert.equal(secondDevice.online.count, 1);
    assert.equal(secondDevice.online.registered, 1);
    assert.equal(secondDevice.online.guests, 0);
    assert.equal(secondDevice.online.reading, 1);
    assert.deepEqual(
      secondDevice.online.users.map((user) => ({ ...user })),
      [{ id: 'alice', name: 'Alice', avatar: '' }],
    );
    assert.equal(JSON.stringify(secondDevice.online).includes('secret'), false);
    assert.equal(JSON.stringify(secondDevice.online).includes(first.visitor), false);
    assert.equal((await visitorSnapshot(db, 4000 + PRESENCE_WINDOW)).count, 0);
    sqlite.exec("DELETE FROM sessions WHERE token_hash='secret'");
    assert.equal((await visitorSnapshot(db, 5000)).count, 0);
    await assert.rejects(
      touchVisitor(db, { activity: 'private title name' }, '', null, null),
      /valid presence/,
    );
  } finally {
    sqlite.close();
  }
});

test('member total is not capped by the public avatar preview', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    'CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,avatar TEXT); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER);',
  );
  sqlite.exec(presenceSchema);
  for (let i = 0; i < 85; i++) {
    sqlite.prepare("INSERT INTO users VALUES(?,?,'')").run(`u${i}`, `Member ${i}`);
    sqlite.prepare('INSERT INTO sessions VALUES(?,?,9999999)').run(`s${i}`, `u${i}`);
    sqlite
      .prepare("INSERT INTO visitor_presence VALUES(?,?,?,'browsing',1000)")
      .run(`v${i}`, `u${i}`, `s${i}`);
  }
  const db = Object.fromEntries(
    ['get', 'all'].map((method) => [
      method,
      (sql, ...values) => sqlite.prepare(sql)[method](...values),
    ]),
  );
  const state = await visitorSnapshot(db, 2000);
  assert.equal(state.count, 85);
  assert.equal(state.registered, 85);
  assert.equal(state.users.length, 80);
  sqlite.close();
});
