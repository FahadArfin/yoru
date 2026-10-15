import { createHash, randomBytes } from 'node:crypto';
import { apiError } from './validation.js';

export const VIEW_COOKIE = 'yoru_viewer';
export const VIEW_COOKIE_SECONDS = 30 * 86400;
export const VIEW_WINDOW = 7 * 86400000;
export const trendingQuery = `SELECT media_id, COUNT(*) AS viewers, MAX(last_seen) AS latest
  FROM watch_views WHERE last_seen > ? AND category = 'ANIME'
  GROUP BY media_id ORDER BY viewers DESC, latest DESC, media_id ASC LIMIT 18`;

export const trendingMangaQuery = trendingQuery.replace("'ANIME'", "'MANGA'");
export const trendingManhwaQuery = trendingQuery.replace("'ANIME'", "'MANHWA'");
export const recordWatchView = (id, cookie, options) =>
  recordMediaView(id, cookie, 'ANIME', options);
export const recordReadView = (id, cookie, options) =>
  recordMediaView(id, cookie, 'MANGA', options);

async function recordMediaView(id, cookie, category, { db, media, now = Date.now() }) {
  const kind = category.toLowerCase();
  if (!new RegExp(`^mal-${kind}-[1-9]\\d{0,8}$`).test(id || ''))
    throw apiError(400, `Invalid ${kind} ID.`);
  const title = await media(id);
  const allowed = category === 'ANIME' ? ['ANIME'] : ['MANGA', 'MANHWA'];
  if (!title || title.id !== id || !allowed.includes(title.category) || title.isAdult)
    throw apiError(404, `This ${kind} is unavailable.`);
  const visitor = /^[A-Za-z0-9_-]{43}$/.test(cookie || '')
    ? cookie
    : randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(visitor).digest('hex');
  await db.run(
    `INSERT INTO watch_views(media_id,visitor_hash,last_seen,category) VALUES(?,?,?,?)
    ON CONFLICT(media_id,visitor_hash) DO UPDATE SET last_seen=MAX(watch_views.last_seen,excluded.last_seen),category=excluded.category`,
    id,
    hash,
    now,
    title.category,
  );
  await db.run('DELETE FROM watch_views WHERE last_seen<=?', now - VIEW_WINDOW);
  return visitor;
}

export const getTrendingAnime = (options) => getTrendingMedia('ANIME', options);
export const getTrendingManga = (options) => getTrendingMedia('MANGA', options);
export const getTrendingManhwa = (options) => getTrendingMedia('MANHWA', options);
async function getTrendingMedia(category, { db, media, now = Date.now() }) {
  const rows = await db.all(
    category === 'ANIME'
      ? trendingQuery
      : category === 'MANHWA'
        ? trendingManhwaQuery
        : trendingMangaQuery,
    now - VIEW_WINDOW,
  );
  const items = [];
  // Bound enrichment concurrency; these titles were already resolved when viewed.
  for (let start = 0; start < rows.length; start += 3) {
    const batch = await Promise.all(
      rows.slice(start, start + 3).map(async (row) => {
        const title = await media(row.media_id).catch(() => null);
        return title?.category === category && !title.isAdult
          ? { ...title, viewers: row.viewers }
          : null;
      }),
    );
    items.push(...batch.filter(Boolean));
  }
  return {
    mode: 'trending',
    category,
    period: 'week',
    items,
    state: rows.length && !items.length ? 'unavailable' : 'ready',
    source: 'Yoru',
    caption: `Unique ${category === 'ANIME' ? 'watch' : 'read'}-page visitors · Past 7 days`,
  };
}
