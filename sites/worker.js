import { getAraCatalog, scopeAraSchedule } from '../server/ara-ara.js';
import { Hono } from 'hono';
import {
  getCatalogPreferences,
  changeReaderPreference,
  resetCatalogPreferences,
} from '../server/catalog-preferences.js';
import { getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { store, sitesReaderDb } from './store.js';
import {
  resolveReaderContext,
  saveReaderContext,
  readerContextResponse,
  readerGuestId,
  READER_GUEST_COOKIE,
  READER_CONTEXT_SECONDS,
} from '../server/reader-context.js';
import { resolveMedia } from '../server/media-resolver.js';
import { createExtensionGateway } from '../server/extension-gateway.js';
import {
  authRoutes,
  sessionMiddleware,
  originGuard,
  discordEnabled,
  rateLimit,
  cookieOptions,
} from './security.js';
import { socialRoutes } from './social.js';
import { roomRoutes, reconcileRooms } from './rooms.js';
import { eventRoutes } from './events.js';
import { importRoutes } from './imports.js';
import { malRoutes } from './mal.js';
import { malConfiguration } from '../server/mal-core.js';
import {
  searchCatalog,
  searchSuggestions,
  getMedia,
  getCalendar,
  parseMediaId,
  rememberDiscoveredMedia,
  fetchAnimeEpisodePage,
  fetchAnimeCast,
} from '../server/catalog-core.js';
import { getMangaDiscovery } from '../server/manga-discovery.js';
import { getAnimeEpisodes } from '../server/anime-episodes.js';
import { getAnimeCast } from '../server/anime-cast.js';
import { apiError } from '../server/validation.js';
import { withCatalog } from './catalog-storage.js';
import { resolveAnimeSources } from '../server/sources-core.js';
import { getSchedule } from '../server/schedule-core.js';
import { getChapterCalendar } from '../server/chapter-calendar.js';
import { scheduleOptions } from './schedule-storage.js';
import { getHomeSidebar, mostViewedQuery } from '../server/home-sidebar.js';
import { getHome } from '../server/home-core.js';
import { getPopularAnime } from '../server/home-discovery.js';
import {
  getTrendingAnime,
  getTrendingManga,
  getTrendingManhwa,
  recordReadView,
  recordWatchView,
  VIEW_COOKIE,
  VIEW_COOKIE_SECONDS,
} from '../server/watch-views.js';
import { seed, isOffline } from './catalog-storage.js';
import {
  getReadingCatalog,
  getReadingSources,
  getReaderChapter,
  getReaderPage,
  registerReaderBridge,
  getReaderCatalogs,
  getReaderCover,
} from '../server/reading-sources.js';
import { chapterStats, recordChapterOpen, rateChapter } from '../server/chapter-activity.js';
import { requireAuth } from './security.js';
import { touchVisitor, PRESENCE_COOKIE } from '../server/visitor-presence.js';

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
const contextOptions = (c, guestId = getCookie(c, READER_GUEST_COOKIE)) => ({
  db: sitesReaderDb(c.get('db')),
  userId: c.get('user')?.id,
  sessionHash: c.get('sessionHash'),
  guestId,
  extensionsEnabled: c.env.READER_EXTENSIONS_ENABLED,
  signal: c.req.raw.signal,
});
app.use('/api/media/*', async (c, next) => {
  c.set('readerContext', await resolveReaderContext(c.req.query(), contextOptions(c)));
  await next();
});
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
app.get('/api/ara-ara/catalog', async (c) => c.json(await getAraCatalog()));
app.get('/api/catalog', async (c) => c.json(await searchCatalog(c.req.query())));
app.post('/api/presence', async (c) => {
  const result = await touchVisitor(
    c.get('db'),
    await c.req.json(),
    getCookie(c, PRESENCE_COOKIE),
    c.get('user'),
    c.get('sessionHash'),
  );
  if (result.visitor !== getCookie(c, PRESENCE_COOKIE))
    setCookie(c, PRESENCE_COOKIE, result.visitor, cookieOptions(c));
  return c.json(result.online);
});
app.get('/api/search/suggestions', async (c) => c.json(await searchSuggestions(c.req.query())));
const chapterOptions = (c) => ({
  ...scheduleOptions(c.env),
  bridgeKey: c.env.READER_BRIDGE_KEY,
  bridgeUrl: c.env.READER_BRIDGE_URL,
  cacheScope: c.env.DB,
  offline: isOffline(),
  media: getMedia,
  db: c.get('db'),
  userId: c.get('user')?.id,
  sessionHash: c.get('sessionHash'),
  readerDb: sitesReaderDb(c.get('db')),
  context: c.get('readerContext'),
});
for (const method of ['get', 'post'])
  app[method]('/api/reader/context', async (c) => {
    const guestId = c.get('user') ? undefined : readerGuestId(getCookie(c, READER_GUEST_COOKIE));
    const context = await (method === 'post' ? saveReaderContext : resolveReaderContext)(
      method === 'post' ? await c.req.json() : c.req.query(),
      contextOptions(c, guestId),
    );
    if (guestId)
      setCookie(c, READER_GUEST_COOKIE, guestId, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: new URL(c.req.url).protocol === 'https:',
        path: '/',
        maxAge: READER_CONTEXT_SECONDS,
      });
    c.header('Cache-Control', 'no-store');
    return c.json(readerContextResponse(context));
  });
app.get('/api/media/:id/cover', async (c) => {
  const image = await getReaderCover(c.req.param('id'), chapterOptions(c));
  return new Response(image.body, {
    headers: {
      'content-type': image.type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-yoru-cache': image.cached ? 'hit' : 'miss',
    },
  });
});
app.post('/api/reader-bridge/register', async (c) =>
  c.json(
    await registerReaderBridge(
      (c.req.header('authorization') || '').replace(/^Bearer /, ''),
      await c.req.json(),
      chapterOptions(c),
    ),
  ),
);
app.get('/api/media/:id/reading-sources', async (c) =>
  c.json(await getReadingSources(c.req.param('id'), chapterOptions(c))),
);
app.get('/api/reader/catalogs', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await getReaderCatalogs(chapterOptions(c)));
});
app.get('/api/reader/preferences', async (c) =>
  c.json(
    await getCatalogPreferences({ db: sitesReaderDb(c.get('db')), userId: c.get('user')?.id }),
  ),
);
app.patch('/api/reader/preferences', requireAuth, async (c) =>
  c.json(
    await changeReaderPreference(await c.req.json(), {
      db: sitesReaderDb(c.get('db')),
      userId: c.get('user').id,
      sessionHash: c.get('sessionHash'),
    }),
  ),
);
app.delete('/api/reader/preferences', requireAuth, async (c) =>
  c.json(
    await resetCatalogPreferences(await c.req.json(), {
      db: sitesReaderDb(c.get('db')),
      userId: c.get('user').id,
      sessionHash: c.get('sessionHash'),
    }),
  ),
);
app.get('/api/media/:id/reader/:chapter', async (c) =>
  c.json(await getReaderChapter(c.req.param('id'), c.req.param('chapter'), chapterOptions(c))),
);
app.get('/api/media/:id/reader/:chapter/page/:page', async (c) => {
  const page = await getReaderPage(
    c.req.param('id'),
    c.req.param('chapter'),
    c.req.param('page'),
    chapterOptions(c),
  );
  return new Response(page.body, {
    headers: {
      'content-type': page.type,
      'cache-control': 'no-store',
      'x-yoru-cache': page.cached ? 'hit' : 'miss',
      'x-content-type-options': 'nosniff',
    },
  });
});
app.get('/api/media/:id/chapters', async (c) => {
  const options = chapterOptions(c);
  const result = await getReadingCatalog(c.req.param('id'), c.req.query(), options);
  const stats = await chapterStats(
    options.db,
    c.req.param('id'),
    result.items.map((item) => item.id),
    options.userId,
  );
  return c.json({
    ...result,
    items: result.items.map((item) => ({ ...item, stats: stats[item.id] })),
  });
});
app.post('/api/media/:id/chapters/:chapter/open', async (c) => {
  const result = await recordChapterOpen(
    c.req.param('id'),
    c.req.param('chapter'),
    getCookie(c, VIEW_COOKIE),
    chapterOptions(c),
  );
  setCookie(c, VIEW_COOKIE, result.visitor, { ...cookieOptions(c), maxAge: VIEW_COOKIE_SECONDS });
  return c.json(result.stats);
});
app.post('/api/media/:id/chapters/:chapter/rating', requireAuth, async (c) => {
  const body = await c.req.json();
  return c.json(
    await rateChapter(c.req.param('id'), c.req.param('chapter'), body.rating, chapterOptions(c)),
  );
});
app.on('GET', ['/api/manga/discovery', '/api/manhwa/discovery'], async (c) => {
  const manhwa = c.req.path === '/api/manhwa/discovery';
  return c.json(
    c.req.query('mode') === 'trending'
      ? await (manhwa ? getTrendingManhwa : getTrendingManga)({ db: c.get('db'), media: getMedia })
      : await getMangaDiscovery(c.req.query(), {
          ...scheduleOptions(c.env),
          category: manhwa ? 'MANHWA' : 'MANGA',
          offline: isOffline(),
          remember: rememberDiscoveredMedia,
        }),
  );
});
app.post('/api/media/:id/read-view', async (c) => {
  const visitor = await recordReadView(c.req.param('id'), getCookie(c, VIEW_COOKIE), {
    db: c.get('db'),
    media: getMedia,
  });
  setCookie(c, VIEW_COOKIE, visitor, { ...cookieOptions(c), maxAge: VIEW_COOKIE_SECONDS });
  return c.json({ ok: true });
});
app.get('/api/media/:id/sources', async (c) =>
  c.json(await resolveAnimeSources(c.req.param('id'), c.req.query())),
);
app.get('/api/media/:id/episodes', async (c) =>
  c.json(
    await getAnimeEpisodes(c.req.param('id'), c.req.query(), {
      ...scheduleOptions(c.env),
      media: getMedia,
      request: fetchAnimeEpisodePage,
      offline: isOffline(),
    }),
  ),
);
app.get('/api/media/:id/cast', async (c) =>
  c.json(
    await getAnimeCast(c.req.param('id'), {
      ...scheduleOptions(c.env),
      media: getMedia,
      request: fetchAnimeCast,
      offline: isOffline(),
    }),
  ),
);
app.get('/api/media/:id', async (c) => {
  const options = chapterOptions(c);
  const media = await resolveMedia(c.req.param('id'), c.get('readerContext'), {
    db: sitesReaderDb(c.get('db')),
    coreMedia: getMedia,
    bridge: createExtensionGateway({
      ...options,
      extensionsEnabled: c.env.READER_EXTENSIONS_ENABLED,
    }),
  });
  return c.json(media);
});
app.post('/api/media/:id/view', async (c) => {
  const visitor = await recordWatchView(c.req.param('id'), getCookie(c, VIEW_COOKIE), {
    db: c.get('db'),
    media: getMedia,
  });
  setCookie(c, VIEW_COOKIE, visitor, { ...cookieOptions(c), maxAge: VIEW_COOKIE_SECONDS });
  return c.json({ ok: true });
});
app.get('/api/home/discovery', async (c) =>
  c.json(
    c.req.query('mode') === 'trending'
      ? await getTrendingAnime({ db: c.get('db'), media: getMedia })
      : await getPopularAnime(c.req.query(), scheduleOptions(c.env)),
  ),
);
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
app.get('/api/calendar', async (c) => {
  const result = await getSchedule(c.req.query(), scheduleOptions(c.env));
  return c.json(c.req.query('collection') === 'ara-ara' ? await scopeAraSchedule(result) : result);
});
app.get('/api/chapter-calendar', async (c) => {
  const result = await getChapterCalendar(c.req.query(), {
    ...scheduleOptions(c.env),
    offline: isOffline(),
  });
  return c.json(
    c.req.query('collection') === 'ara-ara'
      ? await scopeAraSchedule(result, result.category.toUpperCase())
      : result,
  );
});

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
