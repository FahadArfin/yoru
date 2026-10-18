import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { authRouter, discordEnabled, originGuard, sessionMiddleware, requireAuth } from './auth.js';
import { socialRouter, closeSocial, broadcast } from './social.js';
import { catalogRouter } from './catalog.js';
import { createImportRouter } from './import.js';
import { createMalRouter, malEnabled } from './mal.js';
import { createFavoritesRouter } from './favorites.js';

export const app = express();
if (process.env.TRUST_PROXY !== undefined) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isFinite(hops) ? hops : process.env.TRUST_PROXY);
}
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'https:', 'data:', 'blob:'],
        connectSrc: ["'self'", 'https:', 'blob:'],
        frameSrc: ["'self'", 'https:'],
        mediaSrc: ["'self'", 'https:', 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false'
            ? []
            : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(
  compression({
    filter: (req, res) => (req.path === '/api/events' ? false : compression.filter(req, res)),
  }),
);
app.use(
  '/api',
  rateLimit({
    windowMs: 60000,
    limit: process.env.NODE_ENV === 'test' ? 5000 : 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again shortly.' },
  }),
);
app.use(express.json({ limit: '3mb' }));
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', originGuard, sessionMiddleware);
const writeLimiter = rateLimit({
  windowMs: 60000,
  limit: process.env.NODE_ENV === 'test' ? 5000 : 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Please slow down and try again in a moment.' },
});
app.use('/api', (req, res, next) =>
  ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : writeLimiter(req, res, next),
);
app.get('/api/health', (_req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true, name: 'Yoru', persistence: 'sqlite' });
});
app.get('/api/config', (_req, res) =>
  res.json({
    auth: { email: true, discord: discordEnabled, mal: malEnabled },
    discordEnabled,
    discordInviteUrl: process.env.DISCORD_INVITE_URL || null,
    features: {
      library: true,
      reviews: true,
      comments: true,
      rooms: true,
      chat: true,
      presence: true,
      malImport: true,
      malSync: malEnabled,
    },
    realtime: { transport: 'sse', membershipTimeoutSeconds: 90 },
  }),
);
app.use('/api/auth', authRouter);
app.use('/api', catalogRouter);
app.use('/api/import', createImportRouter({ db, requireAuth }));
app.use(
  '/api/import/favorites',
  createFavoritesRouter({ onLibraryChange: (userId) => broadcast('library', { userId }) }),
);
app.use(
  '/api/mal',
  createMalRouter({ onLibraryChange: (userId) => broadcast('library', { userId }) }),
);
app.use('/api', socialRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'This API route does not exist.' }));
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(dist)) {
  app.use(
    express.static(dist, {
      maxAge: '1h',
      setHeaders: (res, path) => {
        if (path.includes(`${join('dist', 'assets')}`))
          res.set('Cache-Control', 'public,max-age=31536000,immutable');
        if (path.endsWith('sw.js')) res.set('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('*', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(join(dist, 'index.html'));
  });
}
app.use((error, _req, res, _next) => {
  if (res.headersSent) return res.end();
  const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500 && !error.expose) console.error('[yoru]', error);
  res.status(status).json({
    error:
      status >= 500 && !error.expose ? 'Something went wrong. Please try again.' : error.message,
  });
});
const port = Number(process.env.PORT || process.env.API_PORT || 5184);
export const server = app.listen(port, process.env.HOST || '0.0.0.0', () =>
  console.log(`Yoru API listening on http://127.0.0.1:${server.address().port}`),
);
function shutdown() {
  closeSocial();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
process.on('message', (message) => {
  if (message === 'shutdown') shutdown();
});
