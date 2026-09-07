import { Router } from 'express';
import { searchCatalog, getMedia, getCalendar, parseMediaId } from './catalog-core.js';
export * from './catalog-core.js';

export const catalogRouter = Router();
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
    res.json(await getCalendar(req.query));
  } catch (error) {
    next(error);
  }
});
