import { createServer } from 'node:http';
import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { superviseTunnel } from './tunnel.mjs';
export { tunnelAddress } from './tunnel.mjs';
import { pathToFileURL } from 'node:url';
import { Providers } from './providers.mjs';
import { pruneSuwayomiCache } from './cache.mjs';

const equal = (a, b) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
export function bridgeHandler({
  key,
  provider,
  instanceId = randomUUID(),
  extensionsEnabled = process.env.READER_EXTENSIONS_ENABLED === '1',
}) {
  let active = 0;
  return async (request) => {
    if (
      !key ||
      key.length < 32 ||
      !equal(request.headers.get('authorization') || '', `Bearer ${key}`)
    )
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET')
      return Response.json({ ok: true, instanceId }, { headers: { 'cache-control': 'no-store' } });
    const extensionOperation = {
      '/extension/catalogs': 'catalogs',
      '/extension/browse': 'browse',
      '/extension/details': 'details',
      '/extension/resolve': 'resolveLink',
      '/extension/chapters': 'chapters',
      '/extension/chapter': 'chapter',
      '/extension/reader': 'reader',
      '/extension/cover': 'cover',
      '/extension/page': 'page',
    }[path];
    if (
      (!['/catalogs', '/sources', '/chapters', '/chapter', '/reader', '/page'].includes(path) &&
        !(extensionsEnabled && extensionOperation)) ||
      request.method !== 'POST'
    )
      return Response.json({ error: 'Not found' }, { status: 404 });
    if (active >= 12)
      return Response.json(
        { error: 'The reader is busy. Try again shortly.' },
        { status: 429, headers: { 'retry-after': '5' } },
      );
    active++;
    try {
      const text = await request.text();
      if (text.length > 16000)
        return Response.json({ error: 'Request too large' }, { status: 413 });
      const body = JSON.parse(text);
      const context = {
        signal: request.signal,
        deadlineAt: Date.now() + 12000,
        priority: path.endsWith('/browse') ? 'discovery' : 'interactive',
      };
      if (extensionOperation) {
        const { sourceId, mode, query, page, filters, cursor, limit, titleRef, editionRef, url } =
          body;
        const args =
          extensionOperation === 'catalogs'
            ? [{ cursor, limit }, context]
            : extensionOperation === 'browse'
              ? [{ sourceId, mode, query, page, filters }, context]
              : extensionOperation === 'resolveLink'
                ? [{ sourceId, url }, context]
                : extensionOperation === 'chapters'
                  ? [titleRef, filters, context]
                  : extensionOperation === 'page'
                    ? [titleRef, editionRef, page, context]
                    : ['chapter', 'reader'].includes(extensionOperation)
                      ? [titleRef, editionRef, context]
                      : [titleRef, context];
        const result = await provider.extensions[extensionOperation](...args);
        if (['cover', 'page'].includes(extensionOperation))
          return new Response(result.body, {
            headers: {
              'content-type': result.type,
              'x-yoru-cache': result.cached ? 'hit' : 'miss',
              'cache-control': 'private, max-age=300',
              'x-content-type-options': 'nosniff',
            },
          });
        return Response.json(result, {
          headers: { 'cache-control': 'no-store' },
        });
      }
      const { media, source, filters, chapterId, page, coreSources } = body;
      if (path === '/catalogs') {
        return Response.json(await provider.catalogs(), {
          headers: { 'cache-control': 'no-store' },
        });
      }
      if (
        !/^mal-manga-[1-9]\d{0,8}$/.test(media?.id || '') ||
        !['MANGA', 'MANHWA'].includes(media.category) ||
        media.isAdult
      )
        return Response.json({ error: 'Invalid manga' }, { status: 400 });
      if (path === '/page') {
        const result = await provider.page(media, chapterId, Number(page));
        return new Response(result.body, {
          headers: {
            'content-type': result.type,
            'x-yoru-cache': result.cached ? 'hit' : 'miss',
            'cache-control': 'private, max-age=300',
            'x-content-type-options': 'nosniff',
          },
        });
      }
      const result =
        path === '/sources'
          ? await provider.sources(media, coreSources)
          : path === '/chapters'
            ? await provider.chapters(media, source, filters)
            : {
                chapter:
                  path === '/reader'
                    ? await provider.reader(media, chapterId)
                    : await provider.chapter(media, chapterId),
              };
      return Response.json(
        { ...result, mediaId: media.id },
        { headers: { 'cache-control': 'no-store' } },
      );
    } catch (e) {
      const status = Number.isInteger(e.status) ? e.status : 503;
      return Response.json(
        { error: e.status ? e.message : 'The reading source is temporarily unavailable.' },
        { status, ...(e.retryAfter ? { headers: { 'retry-after': e.retryAfter } } : {}) },
      );
    } finally {
      active--;
    }
  };
}

export function createBridgeServer(options) {
  const handler = bridgeHandler(options);
  return createServer(async (req, res) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const disconnected = () => {
      if (!res.writableFinished) abort();
    };
    req.once('aborted', abort);
    res.once('close', disconnected);
    const chunks = [];
    let length = 0;
    try {
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 16000) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const response = await handler(
        new Request(`http://bridge${req.url}`, {
          method: req.method,
          headers: req.headers,
          signal: controller.signal,
          ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
        }),
      );
      if (controller.signal.aborted || res.destroyed) return;
      const body = Buffer.from(await response.arrayBuffer());
      if (controller.signal.aborted || res.destroyed) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(body);
    } catch {
      if (!res.destroyed) {
        res.writeHead(503);
        res.end();
      }
    } finally {
      req.removeListener('aborted', abort);
      res.removeListener('close', disconnected);
    }
  });
}

async function start() {
  const key = process.env.READER_BRIDGE_KEY;
  if (!key || key.length < 32) throw new Error('Configure READER_BRIDGE_KEY before starting.');
  const provider = new Providers({
    directory: process.env.CACHE_DIR || '/data',
    suwayomiUrl: process.env.SUWAYOMI_URL,
    password: process.env.SUWAYOMI_PASSWORD,
  });
  const instanceId = randomUUID();
  const server = createBridgeServer({ key, provider, instanceId });
  server.requestTimeout = 45000;
  server.listen(3000, '0.0.0.0', () => console.log('Yoru reader bridge listening.'));
  const cleanImages = () => provider.images.prune().catch(() => {});
  cleanImages();
  setInterval(cleanImages, 15 * 60000).unref();
  if (process.env.SUWAYOMI_CACHE_DIR) {
    const clean = () => pruneSuwayomiCache(process.env.SUWAYOMI_CACHE_DIR).catch(() => {});
    clean();
    setInterval(clean, 15 * 60000).unref();
  }
  if (process.env.READER_TUNNEL === '1') {
    const tunnel = superviseTunnel({ key, instanceId, origin: process.env.YORU_ORIGIN });
    process.once('SIGTERM', () => {
      tunnel.stop();
      server.close();
      process.exit(0);
    });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  start().catch(() => {
    console.error('Reader bridge startup failed.');
    process.exitCode = 1;
  });
