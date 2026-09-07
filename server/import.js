import { Router } from 'express';
import { rememberImportedMedia } from './catalog.js';
import { parseMalXml } from './import-core.js';
export { parseMalXml } from './import-core.js';

export function createImportRouter({ db, requireAuth }) {
  const router = Router();
  router.post('/preview', (req, res) => {
    try {
      res.json(parseMalXml(req.body?.xml));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  router.post('/commit', requireAuth, (req, res, next) => {
    let preview;
    try {
      preview = parseMalXml(req.body?.xml);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const columns = db.prepare('PRAGMA table_info(library)').all();
    const supportsScore = columns.some((column) => column.name === 'score');
    const statement = supportsScore
      ? db.prepare(`INSERT INTO library (user_id, media_id, favorite, status, progress, score, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id,media_id) DO UPDATE SET status=excluded.status, progress=excluded.progress, score=COALESCE(excluded.score,library.score), favorite=MAX(library.favorite,excluded.favorite), updated_at=excluded.updated_at`)
      : db.prepare(`INSERT INTO library (user_id, media_id, favorite, status, progress, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id,media_id) DO UPDATE SET status=excluded.status, progress=excluded.progress, favorite=MAX(library.favorite,excluded.favorite), updated_at=excluded.updated_at`);
    let transactionStarted = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      const now = new Date().toISOString();
      for (const item of preview.items) {
        const values = [
          req.user.id,
          item.mediaId,
          Number(item.favorite),
          item.status,
          item.progress,
        ];
        if (supportsScore) values.push(item.score);
        statement.run(...values, now);
      }
      db.exec('COMMIT');
      transactionStarted = false;
      rememberImportedMedia(preview.items);
      res.json({
        imported: preview.total,
        anime: preview.anime,
        manga: preview.manga,
        skipped: preview.skipped,
        username: preview.username,
        ratingsImported: supportsScore,
        message: `${preview.total} titles saved to your library.`,
      });
    } catch (error) {
      if (transactionStarted) db.exec('ROLLBACK');
      next(error);
    }
  });
  return router;
}
