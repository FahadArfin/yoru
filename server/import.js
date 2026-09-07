import { Router } from 'express';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { rememberImportedMedia } from './catalog.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const parser = new XMLParser({
  ignoreAttributes: true,
  processEntities: true,
  parseTagValue: false,
  trimValues: true,
});

function array(value) {
  return value ? (Array.isArray(value) ? value : [value]) : [];
}
function string(value, max = 300) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, max)
    : '';
}
function nonnegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(1000000, Math.floor(number)) : 0;
}
function statusFor(value, kind) {
  const status = string(value).toLowerCase().replace(/[_ -]/g, '');
  if (['1', 'watching', 'reading'].includes(status))
    return kind === 'anime' ? 'watching' : 'reading';
  if (['2', 'completed'].includes(status)) return 'completed';
  if (['3', 'onhold', 'paused'].includes(status)) return 'paused';
  if (['4', 'dropped'].includes(status)) return 'dropped';
  return 'planned';
}

export function parseMalXml(xml) {
  if (typeof xml !== 'string' || !xml.trim())
    throw new Error('Choose a MyAnimeList XML export file.');
  if (Buffer.byteLength(xml, 'utf8') > MAX_BYTES)
    throw new Error('The XML file is larger than 2 MB. Export a smaller list.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('XML document types and custom entities are not supported.');
  const validation = XMLValidator.validate(xml);
  if (validation !== true)
    throw new Error('This file is not valid XML. Use an uncompressed MyAnimeList export.');
  const parsed = parser.parse(xml);
  if (!parsed.myanimelist || typeof parsed.myanimelist !== 'object')
    throw new Error('This is not a MyAnimeList XML export.');
  const root = parsed.myanimelist;
  const records = [
    ...array(root.anime).map((item) => ({ item, kind: 'anime' })),
    ...array(root.manga).map((item) => ({ item, kind: 'manga' })),
  ];
  if (records.length > MAX_ENTRIES)
    throw new Error(`Import up to ${MAX_ENTRIES} titles at a time.`);
  if (!records.length) throw new Error('The export contains no anime or manga entries.');
  const entries = new Map();
  let skipped = 0;
  for (const { item, kind } of records) {
    const malId = Number(item?.[kind === 'anime' ? 'series_animedb_id' : 'manga_mangadb_id']);
    if (!Number.isSafeInteger(malId) || malId <= 0 || malId > 999999999) {
      skipped++;
      continue;
    }
    const mediaId = `mal-${kind}-${malId}`;
    const score = Number(item.my_score);
    const favorite = ['1', 'true', 'yes'].includes(string(item.my_favorite).toLowerCase());
    entries.set(mediaId, {
      mediaId,
      id: mediaId,
      malId,
      type: kind === 'anime' ? 'ANIME' : 'MANGA',
      title:
        string(item[kind === 'anime' ? 'series_title' : 'manga_title']) ||
        `${kind === 'anime' ? 'Anime' : 'Manga'} #${malId}`,
      status: statusFor(item.my_status, kind),
      progress: nonnegative(item[kind === 'anime' ? 'my_watched_episodes' : 'my_read_chapters']),
      total: nonnegative(item[kind === 'anime' ? 'series_episodes' : 'manga_chapters']) || null,
      score: Number.isInteger(score) && score >= 1 && score <= 10 ? score : null,
      favorite,
    });
  }
  if (!entries.size) throw new Error('No valid MyAnimeList title IDs were found.');
  const items = [...entries.values()];
  return {
    username: string(root.myinfo?.user_name),
    items,
    entries: items,
    total: items.length,
    skipped,
    duplicates: records.length - skipped - items.length,
    anime: items.filter((item) => item.type === 'ANIME').length,
    manga: items.filter((item) => item.type === 'MANGA').length,
    warnings: [
      'Existing list status and progress for matching titles will be updated. Your existing favorites are preserved.',
      'MyAnimeList XML does not normally include favorites. Private notes and tags are not imported.',
      'Manga and manhwa share MyAnimeList manga IDs; titles are categorized when their metadata loads.',
    ],
  };
}

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
