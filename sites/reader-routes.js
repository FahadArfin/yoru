import { getCookie, setCookie } from 'hono/cookie';
import { executeReaderRoute, readerRouteDeps } from '../server/reader-routes.js';
import {
  resolveReaderContext,
  readerGuestId,
  READER_GUEST_COOKIE,
  READER_CONTEXT_SECONDS,
} from '../server/reader-context.js';
import { restartRequired } from '../server/reader-continuation.js';

export function registerSitesReaderRoutes(app, { contextOptions, chapterOptions, coreSearch }) {
  const handler = (action) => async (c) => {
    const guestId = c.get('user') ? undefined : readerGuestId(getCookie(c, READER_GUEST_COOKIE));
    const input = {
      ...c.req.query(),
      ...(action === 'resolve-link' ? await c.req.json() : {}),
      ...c.req.param(),
    };
    const context = await resolveReaderContext(input, contextOptions(c, guestId));
    c.set('readerContext', context);
    const options = { ...chapterOptions(c), coreSearch },
      deps = readerRouteDeps(options);
    if (guestId)
      setCookie(c, READER_GUEST_COOKIE, guestId, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: new URL(c.req.url).protocol === 'https:',
        path: '/',
        maxAge: READER_CONTEXT_SECONDS,
      });
    try {
      const result = await executeReaderRoute(action, input, context, deps, options);
      const current = await resolveReaderContext(input, contextOptions(c, guestId));
      if (current.selectionFingerprint !== context.selectionFingerprint) throw restartRequired();
      c.header('Cache-Control', 'no-store');
      if (action === 'cover')
        return new Response(result.body, {
          headers: {
            'content-type': result.type,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'x-yoru-cache': result.cached ? 'hit' : 'miss',
          },
        });
      return c.json(result);
    } catch (error) {
      if (error.restartRequired)
        return c.json({ error: error.message, restartRequired: true }, 409);
      throw error;
    }
  };
  for (const action of ['catalogs', 'browse', 'discovery', 'suggestions'])
    app.get(`/api/reader/${action}`, handler(action));
  app.post('/api/reader/resolve-link', handler('resolve-link'));
  app.get('/api/reader/media/:id', handler('media'));
  app.get('/api/reader/media/:id/cover', handler('cover'));
  app.get('/api/reader/media/:id/alternatives', handler('alternatives'));
}
