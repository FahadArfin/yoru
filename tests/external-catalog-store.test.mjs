import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identityContract } from './extension-identity-contract.mjs';

identityContract('SQLite', async () => {
  const { nodeReaderDb } = await import('../server/reader-db.js');
  const { createExternalCatalogStore } = await import('../server/external-catalog-store.js');
  const directory = mkdtempSync(join(tmpdir(), 'yoru-identities-'));
  let connection;
  const connect = () => {
    connection = new DatabaseSync(join(directory, 'reader.sqlite'));
    connection.exec('PRAGMA foreign_keys=ON');
    const helpers = {
      get: (sql, ...values) => connection.prepare(sql).get(...values),
      all: (sql, ...values) => connection.prepare(sql).all(...values),
      run: (sql, ...values) => connection.prepare(sql).run(...values),
      transaction(callback) {
        connection.exec('BEGIN IMMEDIATE');
        try {
          const result = callback();
          connection.exec('COMMIT');
          return result;
        } catch (error) {
          connection.exec('ROLLBACK');
          throw error;
        }
      },
    };
    return nodeReaderDb(helpers);
  };
  let db = connect();
  for (const file of readdirSync('drizzle')
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    connection.exec(readFileSync(join('drizzle', file), 'utf8'));
  }
  return {
    db: () => db,
    open: () => createExternalCatalogStore(db),
    reopen() {
      connection.close();
      db = connect();
      return createExternalCatalogStore(db);
    },
    close() {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
});
