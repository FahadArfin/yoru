import { Router } from 'express';
import { searchCatalog, getMedia, getCalendar, parseMediaId } from './catalog-core.js';
import { resolveAnimeSources } from './sources-core.js';
import { getSchedule } from './schedule-core.js';
import { scheduleOptions } from './schedule-storage.js';
import { getHomeSidebar, mostViewedQuery } from './home-sidebar.js';
import { all } from './db.js';
import { getHome } from './home-core.js';
import { seed } from './catalog-storage.js';
export * from './catalog-core.js';

export const catalogRouter = Router();
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
