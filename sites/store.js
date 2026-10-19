import { apiError } from '../server/validation.js';
export const now = () => new Date().toISOString();
export function store(binding) {
  const statement = (sql, ...values) => binding.prepare(sql).bind(...values);
  const db = {
    statement,
    get: (sql, ...values) => statement(sql, ...values).first(),
    all: async (sql, ...values) => (await statement(sql, ...values).all()).results,
    run: (sql, ...values) => statement(sql, ...values).run(),
    batch: (statements) => binding.batch(statements),
  };
  db.guard = (tokenHash, userId) => {
    const batch = async (statements) => {
      // D1 executes a batch atomically. An invalid guard aborts the whole operation,
      // including event writes, rather than merely returning zero rows and continuing.
      const guard = statement(
        "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?) THEN 'true' ELSE 'yoru_session_revoked' END)",
        tokenHash,
        userId,
        Date.now(),
      );
      try {
        return (await binding.batch([guard, ...statements])).slice(1);
      } catch (error) {
        if (
          !(await db.get(
            'SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',
            tokenHash,
            userId,
            Date.now(),
          ))
        )
          throw apiError(401, 'Your session changed. Sign in again.');
        throw error;
      }
    };
    return {
      ...db,
      batch,
      run: async (sql, ...values) => (await batch([statement(sql, ...values)]))[0],
      get: async (sql, ...values) =>
        /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)
          ? (await batch([statement(sql, ...values)]))[0].results[0] || null
          : db.get(sql, ...values),
    };
  };
  return db;
}

/** @returns {import('../shared/reading-contracts.js').ReaderDb} */
export function sitesReaderDb(db) {
  return {
    get: async (sql, ...values) => (await db.get(sql, ...values)) ?? null,
    all: async (sql, ...values) => db.all(sql, ...values),
    run: async (sql, ...values) => db.run(sql, ...values),
    atomic: async (statements, guard) => {
      const target = guard ? db.guard(guard.sessionHash, guard.userId) : db;
      const results = await target.batch(
        statements.map(({ sql, values = [] }) => db.statement(sql, ...values)),
      );
      return results.map((result) => result.results || []);
    },
  };
}
export const liveSession =
  'EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?)';
export const sessionValues = (c) => [c.get('sessionHash'), c.get('user').id, Date.now()];
export function eventStatement(db, event, data, { roomId = null, userId = null } = {}) {
  return db.statement(
    'INSERT INTO event_log(event,payload,room_id,user_id,created_at) VALUES(?,?,?,?,?)',
    event,
    JSON.stringify(data),
    roomId,
    userId,
    Date.now(),
  );
}
export const changes = (result) => result?.meta?.changes || 0;
