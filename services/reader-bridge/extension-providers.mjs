import {
  bridgeError,
  upstreamSourceId,
  normalizeSource,
  normalizeTitle,
  sourceState,
  canonicalKey,
  localInt,
} from './suwayomi-operations.mjs';

/** Generic remote discovery. Bindings are authoritative, injected by the reading
 * adapter: bindings.resolveTitle(ref, context) -> verified {localMangaId}.
 * Cache data is evictable metadata; it is never an identity authority.
 */
export class ExtensionProviders {
  constructor({ client, bindings, metadata, images, now = Date.now, bridgeInstance = null } = {}) {
    Object.assign(this, { client, bindings, metadata, images, now, bridgeInstance });
    this.evidence = new Map();
    this.knownSources = new Map();
  }
  sourceRef(row) {
    const source = normalizeSource(row, { now: this.now(), bridgeInstance: this.bridgeInstance });
    if (!source) return null;
    // Evidence belongs to this exact source/provider/language, not a reused ID.
    const key = JSON.stringify([source.id, source.providerKey, source.language]);
    source.capabilities = { ...source.capabilities, ...this.evidence.get(key) };
    if (row.supportsLatest === false) source.capabilities.latest = 'unsupported';
    return source;
  }
  verified(source, operation) {
    const key = JSON.stringify([source.id, source.providerKey, source.language]);
    this.evidence.set(key, { ...this.evidence.get(key), [operation]: 'supported' });
    source.capabilities[operation] = 'supported';
  }
  async catalogs({ cursor = null, limit = 100 } = {}, context = {}) {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (cursor !== null && (typeof cursor !== 'string' || cursor.length > 2048))
    )
      throw bridgeError(400, 'Invalid catalog page.');
    const data = await this.client.execute('sources', { first: limit, after: cursor }, context);
    if (!Array.isArray(data.sources?.nodes))
      throw bridgeError(502, 'The source returned incompatible catalogs.');
    const sources = data.sources.nodes.map((row) => this.sourceRef(row)).filter(Boolean);
    for (const row of data.sources.nodes)
      if (this.sourceRef(row)) this.knownSources.set(`suwayomi:${row.id}`, row);
    // Only an exhaustive first page proves a previously present source was removed.
    if (cursor === null && data.sources.pageInfo?.hasNextPage === false) {
      const present = new Set(sources.map((s) => s.id));
      for (const id of this.knownSources.keys())
        if (!present.has(id)) {
          this.knownSources.delete(id);
          await this.metadata?.invalidateSource(id);
        }
    }
    return {
      sources,
      nextCursor:
        data.sources.pageInfo?.hasNextPage === true
          ? data.sources.pageInfo.endCursor || null
          : null,
    };
  }
  async source(sourceId, context = {}) {
    const id = upstreamSourceId(sourceId);
    let data;
    try {
      data = await this.client.execute('source', { id }, context);
    } catch (e) {
      if (e.status === 404) {
        this.knownSources.delete(sourceId);
        await this.metadata?.invalidateSource(sourceId);
      }
      throw e;
    }
    const ref = this.sourceRef(data.source);
    if (!ref || ref.id !== sourceId) {
      this.knownSources.delete(sourceId);
      await this.metadata?.invalidateSource(sourceId);
      throw bridgeError(404, 'The selected source is no longer installed.');
    }
    this.knownSources.set(sourceId, data.source);
    return { ref, raw: data.source };
  }
  async cached(key, sourceId, kind, loader, context) {
    return this.metadata
      ? this.metadata.getOrFetch(key, { sourceId, kind }, loader, context)
      : { data: await loader(context), stale: false };
  }
  async browse({ sourceId, mode = 'popular', query = '', page = 1, filters } = {}, context = {}) {
    upstreamSourceId(sourceId);
    if (
      !['popular', 'latest', 'search'].includes(mode) ||
      typeof query !== 'string' ||
      query.length > 200 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000 ||
      (filters != null && (!Array.isArray(filters) || filters.length))
    )
      throw bridgeError(400, 'Invalid remote catalog request.');
    try {
      const source = await this.source(sourceId, context);
      if (source.ref.capabilities[mode] === 'unsupported')
        return {
          items: [],
          nextPage: null,
          hasMore: false,
          sourceState: sourceState(sourceId, mode, 'unsupported'),
        };
      const key = JSON.stringify([source.ref.providerKey, source.ref.language, mode, query, page]);
      const saved = await this.cached(
        key,
        sourceId,
        'feed',
        async (sharedContext) => {
          const data = await this.client.execute(
            'remoteFeed',
            {
              input: {
                source: source.ref.upstreamSourceId,
                type: mode.toUpperCase(),
                page,
                ...(mode === 'search' ? { query } : {}),
              },
            },
            sharedContext,
          );
          const feed = data.fetchSourceManga;
          if (!Array.isArray(feed?.mangas) || typeof feed.hasNextPage !== 'boolean')
            throw bridgeError(502, 'The source returned an incompatible feed.');
          // Cache raw metadata only; source classification is checked afresh above.
          return feed;
        },
        context,
      );
      if (!saved.stale) this.verified(source.ref, mode);
      const items = [
        ...new Map(
          saved.data.mangas
            .map((row) => normalizeTitle(row, source.ref, source.raw))
            .filter(Boolean)
            .map((item) => [item.upstreamRef.upstreamKey, item]),
        ).values(),
      ];
      return {
        items,
        nextPage: saved.data.hasNextPage ? page + 1 : null,
        hasMore: saved.data.hasNextPage,
        sourceState: sourceState(
          sourceId,
          mode,
          saved.stale ? 'stale' : items.length ? 'ready' : 'empty',
        ),
      };
    } catch (e) {
      if (['AbortError', 'TimeoutError'].includes(e.name) || e.status === 400) throw e;
      return {
        items: [],
        nextPage: null,
        hasMore: false,
        sourceState: sourceState(sourceId, mode, 'unavailable', e),
      };
    }
  }
  async boundTitle(ref, context = {}) {
    const source = await this.source(ref?.sourceId, context);
    if (
      typeof ref.upstreamKey !== 'string' ||
      canonicalKey(ref.upstreamKey, source.raw) !== ref.upstreamKey ||
      ref.language !== source.ref.language
    )
      throw bridgeError(409, 'The source binding needs verification.');
    const binding = await this.bindings?.resolveTitle?.(ref, context);
    if (!binding) throw bridgeError(409, 'The source binding needs verification.');
    return { ...source, localMangaId: localInt(binding.localMangaId) };
  }
  async details(ref, context = {}) {
    const source = await this.boundTitle(ref, context);
    const saved = await this.cached(
      JSON.stringify([source.ref.providerKey, ref, source.localMangaId]),
      ref.sourceId,
      'details',
      async (sharedContext) => {
        const data = await this.client.execute(
          'details',
          { input: { id: Number(source.localMangaId) } },
          sharedContext,
        );
        const row = data.fetchManga?.manga;
        const title = normalizeTitle(row, source.ref, source.raw);
        if (
          !title ||
          title.localMangaId !== source.localMangaId ||
          title.upstreamRef.upstreamKey !== ref.upstreamKey
        )
          throw bridgeError(409, 'The source returned a different title.');
        return row;
      },
      context,
    );
    const title = normalizeTitle(saved.data, source.ref, source.raw);
    if (
      !title ||
      title.localMangaId !== source.localMangaId ||
      title.upstreamRef.upstreamKey !== ref.upstreamKey
    )
      throw bridgeError(409, 'The source returned a different title.');
    if (!saved.stale) this.verified(source.ref, 'details');
    return title;
  }
  async resolveLink({ sourceId } = {}) {
    upstreamSourceId(sourceId);
    throw bridgeError(422, 'This source does not support link resolution.', {
      sourceState: sourceState(sourceId, 'resolveLink', 'unsupported'),
    });
  }
}
