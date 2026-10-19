import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { getChapterCatalog, getCatalogChapter } from '../../server/chapter-catalog.js';
import { ImageCache, pruneSuwayomiCache } from './cache.mjs';
import { discoverCatalogs } from '../../shared/reader-connection.js';
import { createSuwayomiClient } from './suwayomi-client.mjs';
import { ExtensionProviders } from './extension-providers.mjs';
import { MetadataCache } from './metadata-cache.mjs';
import { openSourceBindings } from './source-bindings.mjs';

const SW_SOURCE = '2131019126180322627';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SW_CHAPTER = /^sw-weebcentral-([1-9]\d{0,9})-([1-9]\d{0,9})$/;
const cleanName = (name) =>
  String(name || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
const error = (status, message) => Object.assign(new Error(message), { status });
export function sourceIdentity(source, value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
    if (source === 'weebcentral' && u.hostname === 'weebcentral.com')
      return u.pathname.match(/^\/series\/([a-z0-9]{26})(?:\/|$)/i)?.[1].toLowerCase() || null;
    return null;
  } catch {
    return null;
  }
}
export function mappedSources(media, data) {
  if (data?.type !== 'manga' || String(data.id) !== media.id?.slice(10)) return [];
  const titles = new Set(
    [media.title, media.titleEnglish, media.titleRomaji, data.title]
      .filter((x) => typeof x === 'string')
      .map(cleanName),
  );
  return [
    ...new Map(
      Object.values(data.Sites?.Weebcentral || {})
        .filter(
          (row) =>
            row.type === 'manga' &&
            String(row.malId) === media.id.slice(10) &&
            titles.has(cleanName(row.title)) &&
            sourceIdentity('weebcentral', row.url),
        )
        .map((row) => {
          const identity = sourceIdentity('weebcentral', row.url);
          return [
            identity,
            {
              id: 'weebcentral',
              name: 'Weeb Central',
              language: 'en',
              identity,
              title: row.title,
              url: row.url,
            },
          ];
        }),
    ).values(),
  ];
}
export async function boundedBytes(response, max = 4 * 1024 ** 2) {
  if (!response.ok) throw error(503, 'The reading source is unavailable.');
  const declared = Number(response.headers.get('content-length'));
  if (declared > max) throw error(502, 'The source response is too large.');
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw error(502, 'The source response is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

export class Providers {
  async catalogs() {
    return this.cached('supported-catalogs-v1', 60000, () =>
      discoverCatalogs(this.suwayomiUrl, {
        authorization: this.authorization,
        fetchImpl: this.fetchImpl,
        client: this.client,
      }),
    );
  }
  constructor({
    directory = '/data',
    suwayomiUrl = 'http://suwayomi:4567',
    password,
    fetchImpl = fetch,
    client,
    bindings,
    now = Date.now,
    bridgeInstance = null,
  } = {}) {
    Object.assign(this, { directory, suwayomiUrl, fetchImpl });
    this.authorization = `Basic ${Buffer.from(`yoru:${password}`).toString('base64')}`;
    this.images = new ImageCache(join(directory, 'images'), { now });
    this.pending = new Map();
    this.pagePending = new Map();
    this.client =
      client ||
      createSuwayomiClient({ url: suwayomiUrl, authorization: this.authorization, fetchImpl, now });
    this.metadata = new MetadataCache(join(directory, 'extension-metadata'), { now });
    this.extensions = new ExtensionProviders({
      client: this.client,
      bindings:
        bindings ||
        (() =>
          openSourceBindings({
            directory: join(directory, 'source-bindings'),
            client: this.client,
            now,
          })),
      metadata: this.metadata,
      images: this.images,
      now,
      bridgeInstance,
    });
  }
  async load(key) {
    try {
      return JSON.parse(
        await readFile(
          join(this.directory, 'metadata', createHash('sha256').update(key).digest('hex')),
          'utf8',
        ),
      );
    } catch {
      return null;
    }
  }
  async save(key, value) {
    const dir = join(this.directory, 'metadata');
    await mkdir(dir, { recursive: true });
    const path = join(dir, createHash('sha256').update(key).digest('hex'));
    const temp = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value));
    await rename(temp, path);
  }
  async cached(key, ttl, fetcher) {
    if (this.pending.has(key)) return this.pending.get(key);
    const task = (async () => {
      const saved = await this.load(key);
      if (saved && Date.now() - saved.fetchedAt < ttl) return saved.data;
      const data = await fetcher();
      await this.save(key, { fetchedAt: Date.now(), data });
      return data;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  mdOptions(media) {
    return {
      media: async (id) => (id === media.id ? media : null),
      load: this.load.bind(this),
      save: this.save.bind(this),
      cacheScope: this,
    };
  }
  async gql(operation, variables = {}, context = {}) {
    return this.client.execute(operation, variables, context);
  }
  async swMatch(media) {
    return this.cached(`sw-match:${media.id}`, 6 * 3600000, async () => {
      const response = await this.fetchImpl(
        `https://api.malsync.moe/mal/manga/${media.id.slice(10)}`,
        {
          headers: { 'User-Agent': 'YoruReader/1.0 (https://yoru.fwad101.chatgpt.site)' },
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        },
      );
      if (response.status === 404) return null;
      const matches = mappedSources(media, JSON.parse(await boundedBytes(response)));
      if (matches.length !== 1) return null;
      const candidate = matches[0];
      for (const title of [
        ...new Set(
          [candidate.title, media.titleEnglish, media.titleRomaji].filter(
            (x) => typeof x === 'string',
          ),
        ),
      ].slice(0, 3)) {
        const result = await this.gql('CoreSearch', {
          input: { source: SW_SOURCE, type: 'SEARCH', page: 1, query: title },
        });
        const verified = result.fetchSourceManga.mangas.filter(
          (row) =>
            row.sourceId === SW_SOURCE &&
            sourceIdentity(
              'weebcentral',
              row.realUrl || new URL(row.url, 'https://weebcentral.com').href,
            ) === candidate.identity,
        );
        if (verified.length === 1) return { ...candidate, mangaId: verified[0].id };
      }
      return null;
    });
  }
  async sources(media) {
    const sources = [{ id: 'mangadex', name: 'MangaDex', languages: [], native: true }];
    let unavailable = false;
    try {
      const match = await this.swMatch(media);
      if (match)
        sources.push({ id: 'weebcentral', name: 'Weeb Central', languages: ['en'], native: true });
    } catch {
      unavailable = true;
    }
    return { sources, unavailable };
  }
  async swChapters(media) {
    const match = await this.swMatch(media);
    if (!match) throw error(404, 'No verified match on this source.');
    return this.cached(`sw-chapters:${media.id}:${match.mangaId}`, 15 * 60000, async () => {
      const result = await this.gql('CoreChapters', { id: match.mangaId });
      const feed = result.fetchMangaAndChapters;
      if (
        feed.manga.id !== match.mangaId ||
        feed.manga.sourceId !== SW_SOURCE ||
        sourceIdentity('weebcentral', feed.manga.realUrl) !== match.identity
      )
        throw error(502, 'The source returned a different title.');
      return feed.chapters
        .filter((c) => c.mangaId === match.mangaId)
        .map((c) => ({
          id: `sw-weebcentral-${match.mangaId}-${c.id}`,
          number: c.chapterNumber >= 0 ? String(c.chapterNumber) : '',
          title: String(c.name || '').slice(0, 500),
          volume: '',
          language: 'en',
          groups:
            c.scanlator && c.scanlator !== 'Unknown'
              ? [
                  {
                    id: `swg-${createHash('sha256').update(c.scanlator).digest('hex').slice(0, 24)}`,
                    name: c.scanlator,
                  },
                ]
              : [],
          pages: Math.max(0, c.pageCount || 0),
          publishedAt:
            Number(c.uploadDate) > 0 ? new Date(Number(c.uploadDate)).toISOString() : null,
          external: false,
          native: true,
          source: 'weebcentral',
          readLabel: 'Weeb Central',
        }));
    });
  }
  async chapters(media, source, filters = {}) {
    if (source === 'mangadex') {
      const result = await getChapterCatalog(media.id, filters, this.mdOptions(media));
      return {
        ...result,
        items: result.items.map((c) => ({
          ...c,
          native: !c.external && c.pages > 0,
          source: 'mangadex',
        })),
      };
    }
    if (source !== 'weebcentral') throw error(400, 'Unknown reading source.');
    const all = await this.swChapters(media);
    const offset = Number(filters.offset || 0),
      sort = filters.sort || 'desc',
      language = filters.language || 'en';
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 10000 ||
      !['asc', 'desc'].includes(sort)
    )
      throw error(400, 'Invalid chapter filters.');
    const q = String(filters.q || '')
      .trim()
      .toLowerCase();
    const items = all
      .filter(
        (c) =>
          (language === 'all' || c.language === language) &&
          (!filters.group ||
            filters.group === 'all' ||
            c.groups.some((g) => g.id === filters.group)) &&
          (!q || (/^\d+(\.\d+)?$/.test(q) ? c.number === q : c.title.toLowerCase().includes(q))),
      )
      .sort((a, b) => (Number(a.number) - Number(b.number)) * (sort === 'asc' ? 1 : -1));
    return {
      source: 'Weeb Central',
      state: 'ready',
      items: items.slice(offset, offset + 100),
      total: items.length,
      offset,
      limit: 100,
      nextOffset: offset + 100 < items.length ? offset + 100 : null,
      languages: ['en'],
      stale: false,
    };
  }
  async chapter(media, id) {
    if (UUID.test(id))
      return {
        ...(await getCatalogChapter(media.id, id, this.mdOptions(media))),
        source: 'mangadex',
      };
    if (!SW_CHAPTER.test(id)) throw error(400, 'Invalid chapter.');
    const found = (await this.swChapters(media)).find((c) => c.id === id);
    if (!found) throw error(404, 'This chapter does not belong to this title.');
    return found;
  }
  async pageList(media, id) {
    const chapter = await this.chapter(media, id);
    if (chapter.external) throw error(409, 'This chapter opens with its publisher.');
    const urls = await this.cached(`pages:${media.id}:${id}`, 8 * 60000, async () => {
      if (UUID.test(id)) {
        const response = await this.fetchImpl(
          `https://api.mangadex.org/at-home/server/${id}?forcePort443=true`,
          {
            headers: { 'User-Agent': 'YoruReader/1.0 (https://yoru.fwad101.chatgpt.site)' },
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          },
        );
        const data = JSON.parse(await boundedBytes(response));
        const base = new URL(data.baseUrl);
        if (
          base.protocol !== 'https:' ||
          base.port ||
          base.username ||
          base.password ||
          !/(^|\.)(mangadex\.network|mangadex\.org)$/.test(base.hostname) ||
          !/^[a-f0-9]+$/i.test(data.chapter?.hash)
        )
          throw error(502, 'Invalid image service.');
        return (data.chapter.data || []).map(
          (file) => `${base.origin}/data/${data.chapter.hash}/${encodeURIComponent(file)}`,
        );
      }
      const parts = id.match(SW_CHAPTER);
      const result = await this.gql('CorePages', { chapterId: Number(parts[2]) });
      const data = result.fetchChapterPages;
      if (
        data.chapter.id !== Number(parts[2]) ||
        !data.pages.every((path) =>
          new RegExp(`^/api/v1/manga/${parts[1]}/chapter/\\d+/page/\\d+$`).test(path),
        )
      )
        throw error(502, 'Invalid chapter pages.');
      return data.pages;
    });
    if (!urls.length || urls.length > 500)
      throw error(503, 'No readable pages are available for this chapter.');
    return { chapter, urls };
  }
  async reader(media, id) {
    const { chapter, urls } = await this.pageList(media, id);
    return { ...chapter, pages: urls.map((_, index) => index) };
  }
  async page(media, id, index) {
    const { urls } = await this.pageList(media, id);
    if (!Number.isInteger(index) || index < 0 || index >= urls.length)
      throw error(404, 'Page not found.');
    const key = `${media.id}/${id}/${index}`;
    const saved = await this.images.get(key);
    if (saved) return { ...saved, cached: true };
    if (this.pagePending.has(key)) return this.pagePending.get(key);
    const pending = (async () => {
      const sw = SW_CHAPTER.test(id);
      const started = Date.now();
      const sourceImage = sw ? await this.client.fetchImage(urls[index]) : null;
      const response = sw
        ? null
        : await this.fetchImpl(urls[index], {
            headers: sw
              ? { authorization: this.authorization }
              : { 'User-Agent': 'YoruReader/1.0 (https://yoru.fwad101.chatgpt.site)' },
            redirect: 'error',
            signal: AbortSignal.timeout(30000),
          });
      const type = sourceImage?.type || response.headers.get('content-type')?.split(';')[0];
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(type))
        throw error(502, 'The source did not return an image.');
      const body = sourceImage
        ? Buffer.from(sourceImage.body)
        : await boundedBytes(response, 20 * 1024 ** 2);
      await this.images.put(key, body, type);
      if (!sw && new URL(urls[index]).hostname.endsWith('.mangadex.network')) {
        await this.fetchImpl('https://api.mangadex.network/report', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: urls[index],
            success: true,
            cached: response.headers.get('x-cache')?.startsWith('HIT') || false,
            bytes: body.length,
            duration: Date.now() - started,
          }),
          signal: AbortSignal.timeout(3000),
        }).catch(() => {});
      }
      if (process.env.SUWAYOMI_CACHE_DIR) await pruneSuwayomiCache(process.env.SUWAYOMI_CACHE_DIR);
      return { body, type, cached: false };
    })().finally(() => this.pagePending.delete(key));
    this.pagePending.set(key, pending);
    return pending;
  }
}
