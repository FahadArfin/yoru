import { randomUUID } from 'node:crypto';
import { parseMalXml } from '../server/import-core.js';
import { normalizePublicFavorites } from '../server/favorites-core.js';
import { rememberImportedMedia } from '../server/catalog-core.js';
import { apiError } from '../server/validation.js';
import { requireAuth, rateLimit, randomToken, hashToken, remoteJson } from './security.js';
import { now, liveSession, sessionValues, changes, eventStatement } from './store.js';

export function metadataStatement(db, entries, condition = '1', values = []) {
  // Only public metadata is shared; statuses, notes, scores, and usernames are excluded.
  const metadata = entries.map(({ mediaId, malId, title, type, total }) => ({
    mediaId,
    malId,
    title,
    type,
    total,
  }));
  return db.statement(
    `INSERT INTO imported_media(media_id,metadata) SELECT json_extract(value,'$.mediaId'),value FROM json_each(?) WHERE ${condition} ON CONFLICT(media_id) DO NOTHING`,
    JSON.stringify(metadata),
    ...values,
  );
}
export function importStatement(db, userId, entries, condition = '1', values = [], mode = 'xml') {
  const compact = entries.map((x) => [
    x.mediaId,
    Number(Boolean(x.favorite)),
    x.status || 'planned',
    x.progress || 0,
    x.score ?? null,
  ]);
  const updates =
    mode === 'favorites'
      ? 'favorite=1,updated_at=excluded.updated_at'
      : `status=excluded.status,progress=excluded.progress,score=${mode === 'xml' ? 'COALESCE(excluded.score,library.score)' : 'excluded.score'},favorite=MAX(library.favorite,excluded.favorite),updated_at=excluded.updated_at`;
  return db.statement(
    `INSERT INTO library(user_id,media_id,favorite,status,progress,score,updated_at)
    SELECT ?,json_extract(value,'$[0]'),${mode === 'favorites' ? '1' : "json_extract(value,'$[1]')"},json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),?
    FROM json_each(?) WHERE ${condition} ON CONFLICT(user_id,media_id) DO UPDATE SET ${updates}`,
    userId,
    now(),
    JSON.stringify(compact),
    ...values,
  );
}
export function importRoutes(app) {
  const parse = async (c) => {
    try {
      return parseMalXml((await c.req.json()).xml);
    } catch (error) {
      throw apiError(400, error.message);
    }
  };
  app.post('/api/import/preview', async (c) => c.json(await parse(c)));
  app.post('/api/import/commit', requireAuth, async (c) => {
    const preview = await parse(c),
      db = c.get('db'),
      userId = c.get('user').id;
    const result = await db.batch([
      importStatement(db, userId, preview.items, liveSession, sessionValues(c)),
      metadataStatement(db, preview.items, liveSession, sessionValues(c)),
      eventStatement(db, 'library', { userId }, { userId }),
    ]);
    if (!changes(result[0])) throw apiError(401, 'Your session changed. Sign in again.');
    rememberImportedMedia(preview.items);
    return c.json({
      imported: preview.total,
      anime: preview.anime,
      manga: preview.manga,
      skipped: preview.skipped,
      username: preview.username,
      ratingsImported: true,
      message: `${preview.total} titles saved to your library.`,
    });
  });
  app.post('/api/import/favorites/preview', requireAuth, async (c) => {
    await rateLimit(c, 'favorites', 5, 5 * 60000);
    const username = String((await c.req.json()).username || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(username))
      throw apiError(
        400,
        'Use a MyAnimeList username with 1–32 letters, numbers, hyphens, or underscores.',
      );
    if (c.env.CATALOG_OFFLINE === '1')
      throw apiError(
        503,
        'Public favorites lookup is unavailable in offline mode. Your library is unchanged; try again when the provider is available.',
      );
    const items = normalizePublicFavorites(
      await remoteJson(`https://api.jikan.moe/v4/users/${encodeURIComponent(username)}/favorites`, {
        headers: { Accept: 'application/json' },
      }),
    );
    const db = c.get('db'),
      previewToken = randomToken(),
      expiresAt = Date.now() + 600000;
    const result = await db.batch([
      db.statement(
        'DELETE FROM favorite_previews WHERE session_hash=? OR expires_at<=?',
        c.get('sessionHash'),
        Date.now(),
      ),
      db.statement(
        `INSERT INTO favorite_previews(token_hash,session_hash,user_id,username,items,expires_at) SELECT ?,?,?,?,?,? WHERE ${liveSession}`,
        hashToken(previewToken),
        c.get('sessionHash'),
        c.get('user').id,
        username,
        JSON.stringify(items),
        expiresAt,
        ...sessionValues(c),
      ),
    ]);
    if (!changes(result[1])) throw apiError(401, 'Your session changed. Sign in again.');
    return c.json({
      previewToken,
      username,
      total: items.length,
      anime: items.filter((x) => x.type === 'ANIME').length,
      manga: items.filter((x) => x.type === 'MANGA').length,
      items: items.map(({ mediaId, title, type }) => ({ mediaId, title, type })),
      expiresAt: new Date(expiresAt).toISOString(),
    });
  });
  app.post('/api/import/favorites/commit', requireAuth, async (c) => {
    const input = await c.req.json(),
      token =
        typeof input.previewToken === 'string' && input.previewToken.length <= 100
          ? input.previewToken
          : '';
    const db = c.get('db'),
      userId = c.get('user').id,
      tokenHash = hashToken(token),
      claim = randomUUID();
    const preview = await db.get(
      'SELECT items FROM favorite_previews WHERE token_hash=? AND session_hash=? AND user_id=? AND expires_at>? AND claim IS NULL',
      tokenHash,
      c.get('sessionHash'),
      userId,
      Date.now(),
    );
    if (!preview)
      throw apiError(
        400,
        'This favorites preview expired or belongs to a different session. Preview the username again.',
      );
    const items = JSON.parse(preview.items);
    const condition = 'EXISTS(SELECT 1 FROM favorite_previews WHERE token_hash=? AND claim=?)',
      values = [tokenHash, claim];
    const result = await db.batch([
      db.statement(
        `UPDATE favorite_previews SET claim=? WHERE token_hash=? AND session_hash=? AND user_id=? AND expires_at>? AND claim IS NULL AND ${liveSession}`,
        claim,
        tokenHash,
        c.get('sessionHash'),
        userId,
        Date.now(),
        ...sessionValues(c),
      ),
      importStatement(db, userId, items, condition, values, 'favorites'),
      metadataStatement(db, items, condition, values),
      db.statement(
        `INSERT INTO event_log(event,payload,user_id,created_at) SELECT 'library',?,?,? WHERE ${condition}`,
        JSON.stringify({ userId }),
        userId,
        Date.now(),
        ...values,
      ),
    ]);
    if (!changes(result[0]))
      throw apiError(
        400,
        'This favorites preview expired or was already imported. Preview the username again.',
      );
    rememberImportedMedia(items);
    return c.json({
      imported: items.length,
      message: `${items.length} public favorites saved. Your progress, status, and scores were preserved.`,
    });
  });
}
