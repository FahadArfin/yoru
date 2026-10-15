import { createHash, randomBytes } from 'node:crypto';
import { apiError } from './validation.js';

export const VIEW_COOKIE = 'yoru_viewer';
export const VIEW_COOKIE_SECONDS = 30 * 86400;
export const VIEW_WINDOW = 7 * 86400000;
export const trendingQuery = `SELECT media_id, COUNT(*) AS viewers, MAX(last_seen) AS latest
  FROM watch_views WHERE last_seen > ?
  GROUP BY media_id ORDER BY viewers DESC, latest DESC, media_id ASC LIMIT 18`;

export async function recordWatchView(id, cookie, { db, media, now = Date.now() }) {
  if (!/^mal-anime-[1-9]\d{0,8}$/.test(id || '')) throw apiError(400, 'Invalid anime ID.');
  const title = await media(id);
  if (!title || title.id !== id || title.category !== 'ANIME' || title.isAdult)
    throw apiError(404, 'This anime is unavailable.');
  const visitor = /^[A-Za-z0-9_-]{43}$/.test(cookie || '')
    ? cookie
    : randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(visitor).digest('hex');
  await db.run(
    `INSERT INTO watch_views(media_id,visitor_hash,last_seen) VALUES(?,?,?)
    ON CONFLICT(media_id,visitor_hash) DO UPDATE SET last_seen=MAX(watch_views.last_seen,excluded.last_seen)`,
    id,
    hash,
    now,
  );
  await db.run('DELETE FROM watch_views WHERE last_seen<=?', now - VIEW_WINDOW);
  return visitor;
}

export async function getTrendingAnime({ db, media, now = Date.now() }) {
  const rows = await db.all(trendingQuery, now - VIEW_WINDOW);
  const items = [];
  // Bound enrichment concurrency; these titles were already resolved when viewed.
  for (let start = 0; start < rows.length; start += 3) {
    const batch = await Promise.all(
      rows.slice(start, start + 3).map(async (row) => {
        const title = await media(row.media_id).catch(() => null);
        return title?.category === 'ANIME' && !title.isAdult
          ? { ...title, viewers: row.viewers }
          : null;
      }),
    );
    items.push(...batch.filter(Boolean));
  }
  return {
    mode: 'trending',
    period: 'week',
    items,
    state: rows.length && !items.length ? 'unavailable' : 'ready',
    source: 'Yoru',
    caption: 'Unique watch-page visitors · Past 7 days',
  };
}
