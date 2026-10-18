import { Router } from 'express';
import {
  searchCatalog,
  getMedia,
  getCalendar,
  parseMediaId,
  rememberDiscoveredMedia,
} from './catalog-core.js';
import { getMangaDiscovery } from './manga-discovery.js';
import { resolveAnimeSources } from './sources-core.js';
import { getSchedule } from './schedule-core.js';
import { scheduleOptions } from './schedule-storage.js';
import { getHomeSidebar, mostViewedQuery } from './home-sidebar.js';
import { all, run } from './db.js';
import { cookie, asyncRoute, requireAuth } from './auth.js';
import {
  getReadingCatalog,
  getReadingSources,
  getReaderChapter,
  getReaderPage,
  registerReaderBridge,
} from './reading-sources.js';
import { chapterStats, recordChapterOpen, rateChapter } from './chapter-activity.js';
import { getPopularAnime } from './home-discovery.js';
import {
  getTrendingAnime,
  getTrendingManga,
  getTrendingManhwa,
  recordReadView,
  recordWatchView,
  VIEW_COOKIE,
  VIEW_COOKIE_SECONDS,
} from './watch-views.js';
import { getHome } from './home-core.js';
import { seed, isOffline } from './catalog-storage.js';
export * from './catalog-core.js';

export const catalogRouter = Router();
const chapterOptions = (req) => ({
  ...scheduleOptions,
  bridgeKey: process.env.READER_BRIDGE_KEY,
  bridgeUrl: process.env.READER_BRIDGE_URL,
  cacheScope: scheduleOptions,
  offline: isOffline(),
  media: getMedia,
  db: { all, run },
  userId: req.user?.id,
  sessionHash: req.sessionHash,
});
catalogRouter.post(
  '/reader-bridge/register',
  asyncRoute(async (req, res) => {
    res.json(
      await registerReaderBridge(
        (req.headers.authorization || '').replace(/^Bearer /, ''),
        req.body,
        chapterOptions(req),
      ),
    );
  }),
);
catalogRouter.get(
  '/media/:id/reading-sources',
  asyncRoute(async (req, res) =>
    res.json(await getReadingSources(req.params.id, chapterOptions(req))),
  ),
);
catalogRouter.get(
  '/media/:id/reader/:chapter',
  asyncRoute(async (req, res) =>
    res.json(await getReaderChapter(req.params.id, req.params.chapter, chapterOptions(req))),
  ),
);
catalogRouter.get(
  '/media/:id/reader/:chapter/page/:page',
  asyncRoute(async (req, res) => {
    const page = await getReaderPage(
      req.params.id,
      req.params.chapter,
      req.params.page,
      chapterOptions(req),
    );
    res
      .set({
        'content-type': page.type,
        'cache-control': 'private, max-age=300',
        'x-yoru-cache': page.cached ? 'hit' : 'miss',
        'x-content-type-options': 'nosniff',
      })
      .send(page.body);
  }),
);
catalogRouter.get(
  '/media/:id/chapters',
  asyncRoute(async (req, res) => {
    const options = chapterOptions(req);
    const result = await getReadingCatalog(req.params.id, req.query, options);
    const stats = await chapterStats(
      options.db,
      req.params.id,
      result.items.map((item) => item.id),
      options.userId,
    );
    res.json({
      ...result,
      items: result.items.map((item) => ({ ...item, stats: stats[item.id] })),
    });
  }),
);
catalogRouter.post(
  '/media/:id/chapters/:chapter/open',
  asyncRoute(async (req, res) => {
    const result = await recordChapterOpen(
      req.params.id,
      req.params.chapter,
      cookie(req, VIEW_COOKIE),
      chapterOptions(req),
    );
    res.cookie(VIEW_COOKIE, result.visitor, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: VIEW_COOKIE_SECONDS * 1000,
      secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    });
    res.json(result.stats);
  }),
);
catalogRouter.post(
  '/media/:id/chapters/:chapter/rating',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json(
      await rateChapter(req.params.id, req.params.chapter, req.body?.rating, chapterOptions(req)),
    );
  }),
);
catalogRouter.get(['/manga/discovery', '/manhwa/discovery'], async (req, res, next) => {
  try {
    const manhwa = req.path.toLowerCase().replace(/\/$/, '') === '/manhwa/discovery';
    res.json(
      req.query.mode === 'trending'
        ? await (manhwa ? getTrendingManhwa : getTrendingManga)({
            db: { all, run },
            media: getMedia,
          })
        : await getMangaDiscovery(req.query, {
            ...scheduleOptions,
            category: manhwa ? 'MANHWA' : 'MANGA',
            offline: isOffline(),
            remember: rememberDiscoveredMedia,
          }),
    );
  } catch (error) {
    next(error);
  }
});
catalogRouter.post('/media/:id/read-view', async (req, res, next) => {
  try {
    const visitor = await recordReadView(req.params.id, cookie(req, VIEW_COOKIE), {
      db: { all, run },
      media: getMedia,
    });
    res.cookie(VIEW_COOKIE, visitor, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: VIEW_COOKIE_SECONDS * 1000,
      secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
catalogRouter.get('/home/discovery', async (req, res, next) => {
  try {
    res.json(
      req.query.mode === 'trending'
        ? await getTrendingAnime({ db: { all, run }, media: getMedia })
        : await getPopularAnime(req.query, scheduleOptions),
    );
  } catch (error) {
    next(error);
  }
});
catalogRouter.post('/media/:id/view', async (req, res, next) => {
  try {
    const visitor = await recordWatchView(req.params.id, cookie(req, VIEW_COOKIE), {
      db: { all, run },
      media: getMedia,
    });
    res.cookie(VIEW_COOKIE, visitor, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: VIEW_COOKIE_SECONDS * 1000,
      secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
catalogRouter.get('/home/sidebar', async (req, res, next) => {
  try {
    res.json(
      await getHomeSidebar({
        ...scheduleOptions,
        viewed: async () => all(mostViewedQuery),
        media: getMedia,
      }),
    );
  } catch (error) {
    next(error);
  }
});
catalogRouter.get('/home', async (req, res, next) => {
  try {
    res.json(await getHome(req.query, { ...scheduleOptions, artwork: seed.items }));
  } catch (error) {
    next(error);
  }
});
catalogRouter.get('/media/:id/sources', async (req, res, next) => {
  try {
    res.json(await resolveAnimeSources(req.params.id, req.query));
  } catch (error) {
    next(error);
  }
});
catalogRouter.get('/catalog', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, max-age=30').json(await searchCatalog(req.query));
  } catch (error) {
    next(error);
  }
});
catalogRouter.get('/media/:id', async (req, res, next) => {
  try {
    if (!parseMediaId(req.params.id)) return res.status(400).json({ error: 'Invalid media ID' });
    const media = await getMedia(req.params.id);
    if (!media)
      return res.status(404).json({ error: 'This title is unavailable. Please try again later.' });
    res.set('Cache-Control', 'private, max-age=60').json(media);
  } catch (error) {
    next(error);
  }
});
catalogRouter.get('/calendar', async (req, res, next) => {
  try {
    res.json(await getSchedule(req.query, scheduleOptions));
  } catch (error) {
    next(error);
  }
});
