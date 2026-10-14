import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { store } from './store.js';
import {
  authRoutes,
  sessionMiddleware,
  originGuard,
  discordEnabled,
  rateLimit,
} from './security.js';
import { socialRoutes } from './social.js';
import { roomRoutes, reconcileRooms } from './rooms.js';
import { eventRoutes } from './events.js';
import { importRoutes } from './imports.js';
import { malRoutes } from './mal.js';
import { malConfiguration } from '../server/mal-core.js';
import { searchCatalog, getMedia, getCalendar, parseMediaId } from '../server/catalog-core.js';
import { apiError } from '../server/validation.js';
import { withCatalog } from './catalog-storage.js';
import { resolveAnimeSources } from '../server/sources-core.js';
import { getSchedule } from '../server/schedule-core.js';
import { scheduleOptions } from './schedule-storage.js';
import { getHomeSidebar, mostViewedQuery } from '../server/home-sidebar.js';
import { getHome } from '../server/home-core.js';
import { seed } from './catalog-storage.js';

const app = new Hono();
app.use('/api/*', async (c, next) => {
  c.set('db', store(c.env.DB));
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});
app.get('/api/health', async (c) => {
  await c.get('db').get('SELECT 1');
  return c.json({ ok: true, name: 'Yoru', persistence: 'd1' });
});
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 3 * 1024 * 1024,
    onError: (c) => c.json({ error: 'The request is larger than 3 MB.' }, 413),
  }),
);
app.use('/api/*', originGuard, sessionMiddleware);
app.use('/api/*', async (c, next) => {
  // Drain bounded write bodies even for routes such as logout and leave. Keeping
  // unread bytes on these requests can reset the client's next keep-alive request.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.raw.body) {
    const body = await c.req.text();
    if (body.trim()) {
      try {
        JSON.parse(body);
      } catch {
        throw apiError(400, 'Enter valid JSON.');
      }
    }
  }
  await next();
});
app.use('/api/*', async (c, next) => {
  if (c.env.YORU_TEST_MODE !== '1')
    await rateLimit(
      c,
      ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) ? 'read' : 'write',
      ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) ? 600 : 120,
    );
  await next();
});
app.get('/api/config', (c) => {
  const discord = discordEnabled(c.env),
    mal = malConfiguration(c.env).configured;
  const db = c.get('db'),
    timestamp = Date.now();
  c.executionCtx.waitUntil(
    db
      .batch([
        db.statement('DELETE FROM presence_leases WHERE expires_at<=?', timestamp),
        db.statement('DELETE FROM favorite_previews WHERE expires_at<=?', timestamp),
        db.statement('DELETE FROM oauth_states WHERE expires_at<=?', timestamp),
        db.statement('DELETE FROM mal_oauth_states WHERE expires_at<=?', timestamp),
        db.statement('DELETE FROM rate_limits WHERE expires_at<=?', timestamp),
        db.statement('DELETE FROM sessions WHERE expires_at<=?', timestamp),
        db.statement('DELETE FROM event_log WHERE created_at<?', timestamp - 7 * 86400000),
      ])
      .catch((error) => console.warn('[yoru] Expired record cleanup deferred:', error.message)),
  );
  return c.json({
    auth: { email: true, discord, mal },
    discordEnabled: discord,
    discordInviteUrl: c.env.DISCORD_INVITE_URL || null,
    features: {
      library: true,
      reviews: true,
      comments: true,
      rooms: true,
      chat: true,
      presence: true,
      malImport: true,
      malSync: mal,
    },
    realtime: { transport: 'poll', membershipTimeoutSeconds: 90 },
  });
});
app.get('/api/catalog', async (c) => c.json(await searchCatalog(c.req.query())));
app.get('/api/media/:id/sources', async (c) =>
  c.json(await resolveAnimeSources(c.req.param('id'), c.req.query())),
);
app.get('/api/media/:id', async (c) => {
  if (!parseMediaId(c.req.param('id'))) throw apiError(400, 'Invalid media ID');
  const media = await getMedia(c.req.param('id'));
  if (!media) throw apiError(404, 'This title is unavailable. Please try again later.');
  return c.json(media);
});
app.get('/api/home/sidebar', async (c) =>
  c.json(
    await getHomeSidebar({
      ...scheduleOptions(c.env),
      viewed: () => c.get('db').all(mostViewedQuery),
      media: getMedia,
    }),
  ),
);
app.get('/api/home', async (c) =>
  c.json(await getHome(c.req.query(), { ...scheduleOptions(c.env), artwork: seed.items })),
);
app.get('/api/calendar', async (c) =>
  c.json(await getSchedule(c.req.query(), scheduleOptions(c.env))),
);
authRoutes(app, { onLogout: reconcileRooms });
socialRoutes(app);
roomRoutes(app);
eventRoutes(app);
importRoutes(app);
malRoutes(app);
app.all('/api/*', (c) => c.json({ error: 'This API route does not exist.' }, 404));
app.all('*', async (c) => {
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  if (
    asset.status === 404 &&
    ['GET', 'HEAD'].includes(c.req.method) &&
    !c.req.path.startsWith('/assets/') &&
    !/\.[a-z][a-z0-9]*$/i.test(c.req.path)
  ) {
    // Sites provides the asset binding without Wrangler's SPA fallback option.
    // Resolve app deep links explicitly so chapter URLs and refreshes work there.
    return c.env.ASSETS.fetch(new Request(new URL('/', c.req.url), c.req.raw));
  }
  return asset;
});
app.onError((error, c) => {
  const status = error.status || (error instanceof SyntaxError ? 400 : 500);
  if (status >= 500 && !error.expose) console.error('[yoru]', error.message);
  return c.json(
    {
      error:
        error instanceof SyntaxError
          ? 'Enter valid JSON.'
          : status >= 500 && !error.expose
            ? 'Something went wrong. Please try again.'
            : error.message,
    },
    status,
  );
});
export default {
  fetch: (request, env, ctx) => withCatalog(env, ctx, () => app.fetch(request, env, ctx)),
};
