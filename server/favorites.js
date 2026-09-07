import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { get, run, transaction, now } from './db.js';
import { apiError, asyncRoute, hashToken, requireAuth } from './auth.js';
import { rememberImportedMedia } from './catalog.js';

const PREVIEW_TTL = 10 * 60 * 1000;
const MAX_FAVORITES = 1000;
export function normalizePublicFavorites(payload) {
  if (!payload?.data || !Array.isArray(payload.data.anime) || !Array.isArray(payload.data.manga))
    throw apiError(
      502,
      'The public favorites provider returned an incomplete response. Try again later.',
    );
  if (payload.data.anime.length + payload.data.manga.length > MAX_FAVORITES)
    throw apiError(413, `Import up to ${MAX_FAVORITES} public favorites at a time.`);
  const entries = new Map();
  for (const kind of ['anime', 'manga']) {
    for (const item of payload.data[kind]) {
      if (
        !Number.isSafeInteger(item?.mal_id) ||
        item.mal_id < 1 ||
        item.mal_id > 999999999 ||
        typeof item.title !== 'string' ||
        !item.title.trim()
      )
        throw apiError(
          502,
          'The public favorites provider returned an invalid title. Your library has not changed.',
        );
      const mediaId = `mal-${kind}-${item.mal_id}`;
      entries.set(mediaId, {
        mediaId,
        malId: item.mal_id,
        title: item.title.trim().slice(0, 300),
        type: kind === 'anime' ? 'ANIME' : 'MANGA',
      });
    }
  }
  return [...entries.values()];
}

export function createFavoritesRouter({
  fetchImpl = fetch,
  offline = process.env.CATALOG_OFFLINE === '1',
  onLibraryChange = () => {},
} = {}) {
  const router = Router();
  const previews = new Map();
  const pendingSessions = new Set();
  const limiter = rateLimit({
    windowMs: 5 * 60000,
    limit: process.env.NODE_ENV === 'test' ? 1000 : 5,
    keyGenerator: (req) => req.user.id,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Please wait a few minutes before looking up more public favorites.' },
  });
  function sweep() {
    for (const [key, value] of previews) if (value.expiresAt <= Date.now()) previews.delete(key);
  }
  function sessionValid(req) {
    return get(
      'SELECT token_hash FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',
      req.sessionHash,
      req.user.id,
      Date.now(),
    );
  }
  router.post(
    '/preview',
    requireAuth,
    limiter,
    asyncRoute(async (req, res) => {
      const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
      if (!/^[a-zA-Z0-9_-]{1,32}$/.test(username))
        throw apiError(
          400,
          'Use a MyAnimeList username with 1–32 letters, numbers, hyphens, or underscores.',
        );
      if (offline)
        throw apiError(
          503,
          'Public favorites lookup is unavailable in offline mode. Your library is unchanged; try again when the provider is available.',
        );
      sweep();
      if (pendingSessions.has(req.sessionHash))
        throw apiError(409, 'Your favorites preview is already loading.');
      for (const [key, value] of previews)
        if (value.sessionHash === req.sessionHash) previews.delete(key);
      if (previews.size + pendingSessions.size >= 100)
        throw apiError(503, 'Too many favorites previews are open. Try again in a few minutes.');
      pendingSessions.add(req.sessionHash);
      try {
        const url = `https://api.jikan.moe/v4/users/${encodeURIComponent(username)}/favorites`;
        let response;
        try {
          response = await fetchImpl(url, {
            headers: { Accept: 'application/json' },
            redirect: 'error',
            signal: AbortSignal.timeout(8000),
            credentials: 'omit',
          });
        } catch {
          throw apiError(
            502,
            'The public MyAnimeList favorites provider is unavailable. Your library is unchanged. Try again later.',
          );
        }
        if (response.status === 404)
          throw apiError(
            404,
            'That public MyAnimeList profile could not be found. Check the username.',
          );
        if (response.status === 429)
          throw apiError(429, 'The favorites provider is busy. Wait a minute, then try again.');
        if (!response.ok)
          throw apiError(
            502,
            'Public favorites could not be loaded. Your library is unchanged. Try again later.',
          );
        let payload;
        try {
          payload = await response.json();
        } catch {
          throw apiError(502, 'The favorites provider returned an unreadable response.');
        }
        const items = normalizePublicFavorites(payload);
        if (!sessionValid(req))
          throw apiError(401, 'Your session changed. Sign in and preview the favorites again.');
        const previewToken = randomBytes(32).toString('base64url');
        const expiresAt = Date.now() + PREVIEW_TTL;
        previews.set(hashToken(previewToken), {
          username,
          items,
          userId: req.user.id,
          sessionHash: req.sessionHash,
          expiresAt,
        });
        res.json({
          previewToken,
          username,
          total: items.length,
          anime: items.filter((item) => item.type === 'ANIME').length,
          manga: items.filter((item) => item.type === 'MANGA').length,
          items: items.map(({ mediaId, title, type }) => ({ mediaId, title, type })),
          expiresAt: new Date(expiresAt).toISOString(),
        });
      } finally {
        pendingSessions.delete(req.sessionHash);
      }
    }),
  );
  router.post('/commit', requireAuth, (req, res) => {
    sweep();
    const token =
      typeof req.body.previewToken === 'string' && req.body.previewToken.length <= 100
        ? req.body.previewToken
        : '';
    const key = hashToken(token);
    const preview = previews.get(key);
    if (
      !preview ||
      preview.userId !== req.user.id ||
      preview.sessionHash !== req.sessionHash ||
      !sessionValid(req)
    )
      throw apiError(
        400,
        'This favorites preview expired or belongs to a different session. Preview the username again.',
      );
    const timestamp = now();
    transaction(() => {
      for (const item of preview.items)
        run(
          "INSERT INTO library(user_id,media_id,favorite,status,progress,score,updated_at) VALUES(?,?,1,'planned',0,NULL,?) ON CONFLICT(user_id,media_id) DO UPDATE SET favorite=1,updated_at=excluded.updated_at",
          req.user.id,
          item.mediaId,
          timestamp,
        );
    });
    previews.delete(key);
    rememberImportedMedia(preview.items);
    onLibraryChange(req.user.id);
    res.json({
      imported: preview.items.length,
      message: `${preview.items.length} public favorites saved. Your progress, status, and scores were preserved.`,
    });
  });
  return router;
}
