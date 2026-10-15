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
import { cookie } from './auth.js';
import { getPopularAnime } from './home-discovery.js';
import {
  getTrendingAnime,
  getTrendingManga,
  recordReadView,
  recordWatchView,
  VIEW_COOKIE,
  VIEW_COOKIE_SECONDS,
} from './watch-views.js';
import { getHome } from './home-core.js';
import { seed, isOffline } from './catalog-storage.js';
export * from './catalog-core.js';

export const catalogRouter = Router();
catalogRouter.get('/manga/discovery', async (req, res, next) => {
  try {
    res.json(
      req.query.mode === 'trending'
        ? await getTrendingManga({ db: { all, run }, media: getMedia })
        : await getMangaDiscovery(req.query, {
            ...scheduleOptions,
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
