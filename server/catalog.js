import { getAraCatalog, scopeAraSchedule } from './ara-ara.js';
import { Router } from 'express';
import {
  getCatalogPreferences,
  changeReaderPreference,
  resetCatalogPreferences,
} from './catalog-preferences.js';
import {
  searchCatalog,
  searchSuggestions,
  getMedia,
  getCalendar,
  parseMediaId,
  rememberDiscoveredMedia,
  fetchAnimeEpisodePage,
  fetchAnimeCast,
} from './catalog-core.js';
import { getMangaDiscovery } from './manga-discovery.js';
import { getAnimeEpisodes } from './anime-episodes.js';
import { getAnimeCast } from './anime-cast.js';
import { resolveAnimeSources } from './sources-core.js';
import { getSchedule } from './schedule-core.js';
import { getChapterCalendar } from './chapter-calendar.js';
import { scheduleOptions } from './schedule-storage.js';
import { getHomeSidebar, mostViewedQuery } from './home-sidebar.js';
import { all, run, get, transaction } from './db.js';
import { nodeReaderDb } from './reader-db.js';
import {
  resolveReaderContext,
  saveReaderContext,
  readerContextResponse,
  readerGuestId,
  READER_GUEST_COOKIE,
  READER_CONTEXT_SECONDS,
  nodeReaderSignal,
} from './reader-context.js';
import { resolveMedia } from './media-resolver.js';
import { createExtensionGateway } from './extension-gateway.js';
import { registerNodeReaderRoutes } from './reader-routes.js';
import { cookie, asyncRoute, requireAuth } from './auth.js';
import {
  getReadingCatalog,
  getReadingSources,
  getReaderChapter,
  getReaderPage,
  registerReaderBridge,
  getReaderCover,
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
const preferenceDb = nodeReaderDb({ all, run, get, transaction });
const contextOptions = (req, guestId = cookie(req, READER_GUEST_COOKIE)) => ({
  db: preferenceDb,
  userId: req.user?.id,
  sessionHash: req.sessionHash,
  guestId,
  extensionsEnabled: process.env.READER_EXTENSIONS_ENABLED,
  signal: req.readerSignal,
});
for (const method of ['get', 'post'])
  catalogRouter[method](
    '/reader/context',
    asyncRoute(async (req, res) => {
      const guestId = req.user ? undefined : readerGuestId(cookie(req, READER_GUEST_COOKIE));
      const context = await (method === 'post' ? saveReaderContext : resolveReaderContext)(
        method === 'post' ? req.body : req.query,
        contextOptions(req, guestId),
      );
      if (guestId)
        res.cookie(READER_GUEST_COOKIE, guestId, {
          httpOnly: true,
          sameSite: 'lax',
          secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
          path: '/',
          maxAge: READER_CONTEXT_SECONDS * 1000,
        });
      res.set('Cache-Control', 'no-store').json(readerContextResponse(context));
    }),
  );
catalogRouter.get(
  '/reader/preferences',
  asyncRoute(async (req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json(await getCatalogPreferences({ db: preferenceDb, userId: req.user?.id }));
  }),
);
catalogRouter.patch(
  '/reader/preferences',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json(
      await changeReaderPreference(req.body, {
        db: preferenceDb,
        userId: req.user.id,
        sessionHash: req.sessionHash,
      }),
    );
  }),
);
catalogRouter.delete(
  '/reader/preferences',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json(
      await resetCatalogPreferences(req.body, {
        db: preferenceDb,
        userId: req.user.id,
        sessionHash: req.sessionHash,
      }),
    );
  }),
);
catalogRouter.get(
  '/ara-ara/catalog',
  asyncRoute(async (_req, res) => res.json(await getAraCatalog())),
);
catalogRouter.get(
  '/media/:id/cast',
  asyncRoute(async (req, res) => {
    res.json(
      await getAnimeCast(req.params.id, {
        ...scheduleOptions,
        media: getMedia,
        request: fetchAnimeCast,
        offline: isOffline(),
      }),
    );
  }),
);
catalogRouter.get(
  '/media/:id/episodes',
  asyncRoute(async (req, res) => {
    res.json(
      await getAnimeEpisodes(req.params.id, req.query, {
        ...scheduleOptions,
        media: getMedia,
        request: fetchAnimeEpisodePage,
        offline: isOffline(),
      }),
    );
  }),
);
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
  readerDb: preferenceDb,
  context: req.readerContext,
});
catalogRouter.use(
  '/media/:id',
  asyncRoute(async (req, res, next) => {
    req.readerSignal = nodeReaderSignal(req, res);
    req.readerContext = await resolveReaderContext(req.query, contextOptions(req));
    next();
  }),
);
catalogRouter.get(
  '/media/:id/cover',
  asyncRoute(async (req, res) => {
    const image = await getReaderCover(req.params.id, chapterOptions(req));
    res
      .set({
        'content-type': image.type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-yoru-cache': image.cached ? 'hit' : 'miss',
      })
      .send(image.body);
  }),
);
registerNodeReaderRoutes(catalogRouter, {
  contextOptions,
  chapterOptions,
  coreSearch: searchCatalog,
  cookie,
  asyncRoute,
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
        'cache-control': 'no-store',
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
catalogRouter.get('/search/suggestions', async (req, res, next) => {
  try {
    res.json(await searchSuggestions(req.query));
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
    const options = chapterOptions(req);
    const media = await resolveMedia(req.params.id, req.readerContext, {
      db: preferenceDb,
      coreMedia: getMedia,
      bridge: createExtensionGateway({
        ...options,
        extensionsEnabled: process.env.READER_EXTENSIONS_ENABLED,
      }),
    });
    res.set('Cache-Control', 'no-store').json(media);
  } catch (error) {
    next(error);
  }
});
catalogRouter.get('/calendar', async (req, res, next) => {
  try {
    const result = await getSchedule(req.query, scheduleOptions);
    res.json(req.query.collection === 'ara-ara' ? await scopeAraSchedule(result) : result);
  } catch (error) {
    next(error);
  }
});
catalogRouter.get(
  '/chapter-calendar',
  asyncRoute(async (req, res) => {
    const result = await getChapterCalendar(req.query, {
      ...scheduleOptions,
      offline: isOffline(),
    });
    res.json(
      req.query.collection === 'ara-ara'
        ? await scopeAraSchedule(result, result.category.toUpperCase())
        : result,
    );
  }),
);
