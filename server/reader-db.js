import { apiError } from './validation.js';

/** Adapt synchronous SQLite helpers without holding a transaction over an await.
 * @returns {import('../shared/reading-contracts.js').ReaderDb}
 */
export function nodeReaderDb(sqliteHelpers) {
  const { get, all, run, transaction } = sqliteHelpers;
  return {
    get: async (sql, ...values) => get(sql, ...values) ?? null,
    all: async (sql, ...values) => all(sql, ...values),
    run: async (sql, ...values) => run(sql, ...values),
    atomic: async (statements, guard) =>
      transaction(() => {
        if (
          guard &&
          !get(
            'SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',
            guard.sessionHash,
            guard.userId,
            Date.now(),
          )
        )
          throw apiError(401, 'Your session changed. Sign in again.');
        return statements.map(({ sql, values = [] }) => all(sql, ...values));
      }),
  };
}
