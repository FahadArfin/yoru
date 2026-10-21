import { createHash, randomBytes } from 'node:crypto';
import { getReadingChapter } from './reading-sources.js';
import { apiError } from './validation.js';

export async function chapterStats(db, mediaId, ids, userId = null) {
  const stats = {};
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50);
    if (!batch.length) continue;
    const marks = batch.map(() => '?').join(',');
    const [views, ratings] = await Promise.all([
      db.all(
        `SELECT chapter_id, COUNT(*) AS opens FROM chapter_opens WHERE media_id=? AND chapter_id IN (${marks}) GROUP BY chapter_id`,
        mediaId,
        ...batch,
      ),
      db.all(
        `SELECT chapter_id, COUNT(*) AS votes, AVG(rating) AS rating, MAX(CASE WHEN user_id=? THEN rating END) AS my_rating FROM chapter_ratings WHERE media_id=? AND chapter_id IN (${marks}) GROUP BY chapter_id`,
        userId,
        mediaId,
        ...batch,
      ),
    ]);
    for (const id of batch) stats[id] = { opens: 0, votes: 0, rating: null, myRating: null };
    for (const row of views) stats[row.chapter_id].opens = row.opens;
    for (const row of ratings)
      Object.assign(stats[row.chapter_id], {
        votes: row.votes,
        rating: row.rating,
        myRating: row.my_rating,
      });
  }
  return stats;
}
export async function recordChapterOpen(mediaId, chapterId, cookie, options) {
  if (options.policy) await options.policy.edition(mediaId, chapterId);
  else await getReadingChapter(mediaId, chapterId, options);
  const visitor = /^[A-Za-z0-9_-]{43}$/.test(cookie || '')
    ? cookie
    : randomBytes(32).toString('base64url');
  const statement = {
    sql: 'INSERT OR IGNORE INTO chapter_opens(media_id,chapter_id,visitor_hash,opened_at) VALUES(?,?,?,?)',
    values: [mediaId, chapterId, createHash('sha256').update(visitor).digest('hex'), Date.now()],
  };
  if (options.policy) await options.policy.atomic([statement]);
  else await options.db.run(statement.sql, ...statement.values);
  return {
    visitor,
    stats: (await chapterStats(options.db, mediaId, [chapterId], options.userId))[chapterId],
  };
}
export async function rateChapter(mediaId, chapterId, rating, options) {
  if (!options.userId || !options.sessionHash) throw apiError(401, 'Sign in to rate a chapter.');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw apiError(400, 'Choose a rating from 1 to 5 stars.');
  if (options.policy) await options.policy.edition(mediaId, chapterId);
  else await getReadingChapter(mediaId, chapterId, options);
  // Recheck session ownership at the write, after any provider wait.
  const sql = `INSERT INTO chapter_ratings(media_id,chapter_id,user_id,rating,updated_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?)
    ON CONFLICT(media_id,chapter_id,user_id) DO UPDATE SET rating=excluded.rating,updated_at=excluded.updated_at`;
  const values = [
    mediaId,
    chapterId,
    options.userId,
    rating,
    Date.now(),
    options.sessionHash,
    options.userId,
    Date.now(),
  ];
  const result = options.policy
    ? (await options.policy.atomic([{ sql: sql + ' RETURNING user_id', values }]))[0]
    : await options.db.run(sql, ...values);
  if (!(Array.isArray(result) ? result.length : result.changes || result.meta?.changes))
    throw apiError(401, 'Your session changed. Sign in again.');
  return (await chapterStats(options.db, mediaId, [chapterId], options.userId))[chapterId];
}
