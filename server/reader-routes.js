import {
  getReadingDiscovery,
  getReadingSuggestions,
  searchReadingCatalog,
} from './catalog-aggregation.js';
import { createContinuationStore, restartRequired } from './reader-continuation.js';
import { refreshReaderSources } from './reader-source-inventory.js';
import { createExternalCatalogStore } from './external-catalog-store.js';
import {
  assertSourceEligible,
  assertMediaEligible,
  publicReadingMedia,
  resolveMedia,
} from './media-resolver.js';
import { getReaderCatalogs, getReaderCover } from './reading-sources.js';
import { createExtensionGateway } from './extension-gateway.js';
import {
  resolveReaderContext,
  readerGuestId,
  READER_GUEST_COOKIE,
  READER_CONTEXT_SECONDS,
  nodeReaderSignal,
} from './reader-context.js';
import { apiError } from './validation.js';

export function readerRouteDeps(options) {
  return {
    ...options,
    db: options.readerDb,
    coreMedia: options.media,
    coreSearch: options.coreSearch,
    bridge:
      options.bridge ||
      createExtensionGateway({ ...options, extensionsEnabled: options.context?.extensionsEnabled }),
  };
}
export async function executeReaderRoute(action, input, context, deps, options) {
  if (action === 'catalogs') {
    // Settings retains its complete legacy installed-name inventory even while
    // generic discovery is disabled. Explicit pagination opts into SourceRef DTOs.
    if (input.cursor === undefined && input.limit === undefined) return getReaderCatalogs(options);
    if (!context.extensionsEnabled) throw apiError(404, 'This catalog is unavailable.');
    const limit = input.limit === undefined ? 100 : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw apiError(400, 'Invalid catalog page size.');
    const store = createContinuationStore(deps.db, deps);
    const state = input.cursor
      ? await store.resume(input.cursor, context)
      : { kind: 'catalogs', upstream: null, limit };
    if (state.kind !== 'catalogs' || state.limit !== limit) throw restartRequired();
    const result = await refreshReaderSources(context, deps, {
      cursor: state.upstream,
      limit,
      maxOperations: 1,
    });
    if (result.failure) throw result.failure;
    const sources = result.currentSources.map((s) => ({
      id: s.id,
      integration: s.integration,
      upstreamSourceId: s.upstreamSourceId,
      providerKey: s.providerKey,
      name: s.providerKey,
      language: s.language,
      classification: s.classification,
      capabilities: s.capabilities,
      bridgeInstance: s.bridgeInstance,
    }));
    const nextState = { kind: 'catalogs', upstream: result.nextCursor, limit };
    const nextCursor = result.nextCursor
      ? input.cursor
        ? await store.advance(input.cursor, nextState)
        : await store.start(context, nextState)
      : null;
    return {
      sources,
      nextCursor,
      hasMore: !!nextCursor,
      complete: result.complete,
      sourceStates: result.sourceStates,
      selectionFingerprint: context.selectionFingerprint,
    };
  }
  if (action === 'browse')
    return input.q
      ? searchReadingCatalog(input, context, deps)
      : getReadingDiscovery(input, context, deps);
  if (action === 'discovery') return getReadingDiscovery(input, context, deps);
  if (action === 'suggestions') return getReadingSuggestions(input, context, deps);
  if (action === 'resolve-link') {
    const sourceId = input.source || input.sourceId;
    if (typeof sourceId !== 'string' || !/^suwayomi:[1-9]\d{0,24}$/.test(sourceId))
      throw apiError(400, 'Invalid reading source.');
    // The adapter's resolve operation fetches the exact installed source again;
    // no local Suwayomi integer is accepted as canonical ownership.
    if (!context.extensionsEnabled) throw apiError(404, 'This title is unavailable.');
    const result = await deps.bridge.resolveLink(
      { sourceId, url: input.url },
      {
        signal: context.signal,
        deadlineAt: (deps.now || Date.now)() + 12000,
        priority: 'interactive',
      },
    );
    if (result.sourceRef?.id !== sourceId || result.upstreamRef?.sourceId !== sourceId)
      throw apiError(502, 'Invalid resolved title.');
    assertSourceEligible(result.sourceRef, context, { discovery: true });
    const media = await createExternalCatalogStore(deps.db, deps).rememberTitle(result);
    assertMediaEligible(media, context);
    return publicReadingMedia(media, context);
  }
  if (action === 'media') return resolveMedia(input.id, context, deps);
  if (action === 'cover') return getReaderCover(input.id, options);
  throw apiError(404, 'Reading route unavailable.');
}

export function registerNodeReaderRoutes(
  router,
  { contextOptions, chapterOptions, coreSearch, cookie, asyncRoute },
) {
  const handler = (action) =>
    asyncRoute(async (req, res) => {
      req.readerSignal = nodeReaderSignal(req, res);
      const guestId = req.user ? undefined : readerGuestId(cookie(req, READER_GUEST_COOKIE));
      const input = { ...req.query, ...(action === 'resolve-link' ? req.body : {}), ...req.params };
      const context = await resolveReaderContext(input, contextOptions(req, guestId));
      req.readerContext = context;
      const options = { ...chapterOptions(req), coreSearch },
        deps = readerRouteDeps(options);
      if (guestId)
        res.cookie(READER_GUEST_COOKIE, guestId, {
          httpOnly: true,
          sameSite: 'lax',
          secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
          path: '/',
          maxAge: READER_CONTEXT_SECONDS * 1000,
        });
      try {
        const result = await executeReaderRoute(action, input, context, deps, options);
        const current = await resolveReaderContext(input, contextOptions(req, guestId));
        if (current.selectionFingerprint !== context.selectionFingerprint) throw restartRequired();
        res.set('Cache-Control', 'no-store');
        if (action === 'cover')
          return res
            .set({
              'content-type': result.type,
              'x-content-type-options': 'nosniff',
              'x-yoru-cache': result.cached ? 'hit' : 'miss',
            })
            .send(result.body);
        res.json(result);
      } catch (error) {
        if (error.restartRequired)
          return res
            .status(409)
            .set('Cache-Control', 'no-store')
            .json({ error: error.message, restartRequired: true });
        throw error;
      }
    });
  for (const action of ['catalogs', 'browse', 'discovery', 'suggestions'])
    router.get(`/reader/${action}`, handler(action));
  router.post('/reader/resolve-link', handler('resolve-link'));
  router.get('/reader/media/:id', handler('media'));
  router.get('/reader/media/:id/cover', handler('cover'));
}
