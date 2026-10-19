import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { nodeReaderDb } from '../server/reader-db.js';

export function contextFixture() {
  const connection = new DatabaseSync(':memory:');
  for (const file of readdirSync('drizzle')
    .filter((x) => x.endsWith('.sql'))
    .sort())
    connection.exec(readFileSync(`drizzle/${file}`, 'utf8'));
  const db = nodeReaderDb({
    get: (s, ...v) => connection.prepare(s).get(...v),
    all: (s, ...v) => connection.prepare(s).all(...v),
    run: (s, ...v) => connection.prepare(s).run(...v),
    transaction(fn) {
      connection.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        connection.exec('COMMIT');
        return result;
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    },
  });
  return { db, close: () => connection.close() };
}
