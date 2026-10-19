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
  async bindingStore() {
    // Open only on generic use. Retain the same promise, including rejection:
    // corrupt authoritative state must fail closed without resetting identities
    // or creating an unhandled startup rejection that can terminate core paths.
    if (typeof this.bindings === 'function') this.bindings = this.bindings();
    const bindings = await this.bindings;
    if (bindings?.instanceId) this.bridgeInstance = await bindings.instanceId();
    return bindings;
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
    await this.bindingStore();
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
    await this.bindingStore();
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
      const bindings = await this.bindingStore();
      for (const item of items) await bindings?.rememberTitle?.(item);
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
    const binding = await (await this.bindingStore())?.resolveTitle?.(ref, context);
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
    await (await this.bindingStore())?.rememberTitle?.(title);
    return title;
  }
  edition(row, titleRef, source) {
    const key = canonicalKey(row?.url, source.raw, row?.realUrl);
    if (
      !key ||
      String(row.mangaId) !== source.localMangaId ||
      !Number.isInteger(row.sourceOrder) ||
      row.sourceOrder < 0 ||
      !Number.isInteger(row.pageCount) ||
      row.pageCount < 0
    )
      return null;
    let id;
    try {
      id = localInt(row.id);
    } catch {
      return null;
    }
    return {
      sourceRef: source.ref,
      upstreamRef: { title: titleRef, upstreamKey: key },
      localMangaId: source.localMangaId,
      localChapterId: id,
      metadata: {
        title: String(row.name || '').slice(0, 500),
        number:
          Number.isFinite(row.chapterNumber) && row.chapterNumber >= 0
            ? String(row.chapterNumber)
            : '',
        volume: null,
        language: source.ref.language,
        order: row.sourceOrder,
        pageCount: row.pageCount,
        scanlator: typeof row.scanlator === 'string' ? row.scanlator.slice(0, 500) : null,
        publishedAt:
          Number(row.uploadDate) > 0 && Number(row.uploadDate) <= 8.64e15
            ? new Date(Number(row.uploadDate)).toISOString()
            : null,
      },
    };
  }
  async chapters(titleRef, filters = {}, context = {}) {
    if (
      !filters ||
      typeof filters !== 'object' ||
      Array.isArray(filters) ||
      Object.keys(filters).some((k) => k !== 'language') ||
      (filters.language && filters.language !== titleRef?.language)
    )
      throw bridgeError(400, 'Invalid chapter filters.');
    const source = await this.boundTitle(titleRef, context);
    const data = (
      await this.client.execute(
        'extensionChapters',
        { input: { id: Number(source.localMangaId), fetchManga: true, fetchChapters: true } },
        context,
      )
    ).fetchMangaAndChapters;
    const title = normalizeTitle(data?.manga, source.ref, source.raw);
    if (
      !title ||
      title.localMangaId !== source.localMangaId ||
      title.upstreamRef.upstreamKey !== titleRef.upstreamKey ||
      !Array.isArray(data.chapters)
    )
      throw bridgeError(409, 'The source returned a different title.');
    const items = data.chapters.map((row) => this.edition(row, titleRef, source));
    if (
      items.some((x) => !x) ||
      new Set(items.map((x) => x.upstreamRef.upstreamKey)).size !== items.length
    )
      throw bridgeError(409, 'The chapter binding needs verification.');
    const bindings = await this.bindingStore();
    for (const edition of items) await bindings.rememberEdition(edition);
    this.verified(source.ref, 'chapters');
    return {
      items,
      nextPage: null,
      hasMore: false,
      sourceState: sourceState(titleRef.sourceId, 'chapters', items.length ? 'ready' : 'empty'),
    };
  }
  async boundEdition(titleRef, editionRef, context) {
    if (
      JSON.stringify([titleRef?.sourceId, titleRef?.upstreamKey, titleRef?.language]) !==
      JSON.stringify([
        editionRef?.title?.sourceId,
        editionRef?.title?.upstreamKey,
        editionRef?.title?.language,
      ])
    )
      throw bridgeError(409, 'This chapter does not belong to this title.');
    const source = await this.boundTitle(titleRef, context);
    const binding = await (
      await this.bindingStore()
    )?.resolveEdition(titleRef, editionRef, context);
    if (!binding || String(binding.localMangaId) !== source.localMangaId)
      throw bridgeError(409, 'The chapter binding needs verification.');
    const edition = this.edition(binding.row, titleRef, source);
    if (
      !edition ||
      edition.localChapterId !== binding.localChapterId ||
      edition.upstreamRef.upstreamKey !== editionRef.upstreamKey
    )
      throw bridgeError(409, 'The chapter binding needs verification.');
    return { source, edition };
  }
  async chapter(titleRef, editionRef, context = {}) {
    return (await this.boundEdition(titleRef, editionRef, context)).edition;
  }
  async manifest(titleRef, editionRef, context) {
    const { source, edition } = await this.boundEdition(titleRef, editionRef, context);
    const data = (
      await this.client.execute(
        'extensionPages',
        { input: { chapterId: Number(edition.localChapterId) } },
        context,
      )
    ).fetchChapterPages;
    const actual = this.edition(data?.chapter, titleRef, source);
    const manga = normalizeTitle(data?.chapter?.manga, source.ref, source.raw);
    if (
      !actual ||
      !manga ||
      manga.localMangaId !== source.localMangaId ||
      manga.upstreamRef.upstreamKey !== titleRef.upstreamKey ||
      actual.localChapterId !== edition.localChapterId ||
      actual.upstreamRef.upstreamKey !== editionRef.upstreamKey ||
      actual.metadata.order !== edition.metadata.order
    )
      throw bridgeError(409, 'The source returned a different chapter.');
    if (!Array.isArray(data.pages) || !data.pages.length || data.pages.length > 500)
      throw bridgeError(502, 'No bounded readable pages are available.');
    // Suwayomi's existing REST chapter segment is sourceOrder, not chapter ID
    // or chapter number. Only paths returned for this verified edition pass.
    const prefix = `/api/v1/manga/${source.localMangaId}/chapter/${actual.metadata.order}/page/`;
    if (!data.pages.every((path, index) => path === `${prefix}${index}`))
      throw bridgeError(502, 'Invalid chapter pages.');
    this.verified(source.ref, 'pages');
    return { edition: actual, paths: data.pages };
  }
  async reader(titleRef, editionRef, context = {}) {
    const { edition, paths } = await this.manifest(titleRef, editionRef, context);
    return { edition, pages: paths.map((_, index) => index) };
  }
  async image(key, path, context) {
    const saved = await this.images?.get(key);
    if (saved) return { ...saved, cached: true };
    const result = await this.client.fetchImage(path, context);
    await this.images?.put(key, result.body, result.type);
    return result;
  }
  async page(titleRef, editionRef, index, context = {}) {
    if (!Number.isInteger(index) || index < 0 || index >= 500)
      throw bridgeError(404, 'Page not found.');
    const { edition, paths } = await this.manifest(titleRef, editionRef, context);
    if (index >= paths.length) throw bridgeError(404, 'Page not found.');
    return this.image(
      JSON.stringify([
        this.bridgeInstance,
        titleRef.sourceId,
        titleRef,
        editionRef,
        edition.localMangaId,
        edition.localChapterId,
        paths[index],
      ]),
      paths[index],
      context,
    );
  }
  async cover(titleRef, context = {}) {
    const source = await this.boundTitle(titleRef, context);
    const data = (
      await this.client.execute('bindingTitle', { id: Number(source.localMangaId) }, context)
    ).manga;
    const title = normalizeTitle(data, source.ref, source.raw);
    if (
      !title ||
      title.localMangaId !== source.localMangaId ||
      title.upstreamRef.upstreamKey !== titleRef.upstreamKey
    )
      throw bridgeError(409, 'The source returned a different title.');
    // Never manufacture a cover endpoint: require the returned metadata field
    // to be this exact owned same-Suwayomi-origin path.
    const path = data.thumbnailUrl;
    if (path !== `/api/v1/manga/${source.localMangaId}/thumbnail`)
      throw bridgeError(502, 'No verified source cover is available.');
    return this.image(
      JSON.stringify([
        this.bridgeInstance,
        titleRef.sourceId,
        titleRef,
        'cover',
        source.localMangaId,
        path,
      ]),
      path,
      context,
    );
  }
  async resolveLink({ sourceId } = {}) {
    upstreamSourceId(sourceId);
    throw bridgeError(422, 'This source does not support link resolution.', {
      sourceState: sourceState(sourceId, 'resolveLink', 'unsupported'),
    });
  }
}
