import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bridgeError,
  upstreamSourceId,
  normalizeSource,
  normalizeTitle,
  canonicalKey,
  localInt,
} from './suwayomi-operations.mjs';

const invalid = () => bridgeError(409, 'The source binding needs verification.');
const key = (value) => JSON.stringify([value?.sourceId, value?.upstreamKey, value?.language]);
const same = (a, b) => key(a) === key(b);
const fingerprint = (source) => JSON.stringify([source.id, source.providerKey, source.language]);

// This file is authoritative state, deliberately outside both evictable caches.
export async function openSourceBindings({ directory, client, now = Date.now, uuid = randomUUID }) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'bindings.json');
  let state;
  try {
    state = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw invalid();
  }
  if (
    state &&
    (state.version !== 1 || typeof state.instance !== 'string' || !state.titles || !state.editions)
  )
    throw invalid();
  state ||= { version: 1, instance: uuid(), titles: {}, editions: {} };
  let writes = Promise.resolve();
  const save = () => {
    const data = JSON.stringify(state);
    writes = writes
      .catch(() => {})
      .then(async () => {
        const temp = `${path}.${uuid()}.tmp`;
        await writeFile(temp, data, { mode: 0o600 });
        await rename(temp, path);
      });
    return writes;
  };
  await save();
  async function sourceFor(ref, context) {
    const id = upstreamSourceId(ref?.sourceId);
    const raw = (await client.execute('source', { id }, context)).source;
    const source = normalizeSource(raw, { now: now(), bridgeInstance: state.instance });
    if (
      !source ||
      source.id !== ref.sourceId ||
      source.language !== ref.language ||
      canonicalKey(ref.upstreamKey, raw) !== ref.upstreamKey
    )
      throw invalid();
    return { raw, source };
  }
  function checkedTitle(row, ref, source, raw) {
    const normalized = normalizeTitle(row, source, raw);
    return normalized && same(normalized.upstreamRef, ref) ? normalized : null;
  }
  const api = {
    instanceId: () => state.instance,
    async rememberTitle(title) {
      const ref = title?.upstreamRef;
      if (!ref || title.sourceRef?.id !== ref.sourceId || title.sourceRef.language !== ref.language)
        throw invalid();
      const id = localInt(title.localMangaId);
      const previous = state.titles[key(ref)];
      if (previous && previous.source !== fingerprint(title.sourceRef)) throw invalid();
      state.titles[key(ref)] = {
        localMangaId: id,
        source: fingerprint(title.sourceRef),
        checkedAt: now(),
      };
      await save();
      return { localMangaId: id };
    },
    async rememberEdition(edition) {
      const ref = edition?.upstreamRef;
      if (!ref?.title || !state.titles[key(ref.title)] || !ref.upstreamKey) throw invalid();
      state.editions[JSON.stringify([key(ref.title), ref.upstreamKey])] = {
        localMangaId: localInt(edition.localMangaId),
        localChapterId: localInt(edition.localChapterId),
        checkedAt: now(),
      };
      await save();
    },
    async resolveTitle(ref, context = {}) {
      context = {
        ...context,
        deadlineAt: Math.min(context.deadlineAt ?? Infinity, Date.now() + 12000),
      };
      const { source, raw } = await sourceFor(ref, context);
      const saved = state.titles[key(ref)];
      if (saved && saved.source !== fingerprint(source)) throw invalid();
      if (saved) {
        let row;
        try {
          row = (
            await client.execute(
              'bindingTitle',
              { id: Number(localInt(saved.localMangaId)) },
              context,
            )
          ).manga;
        } catch (e) {
          if (e.status !== 404) throw e;
        }
        const title = checkedTitle(row, ref, source, raw);
        if (title?.localMangaId === saved.localMangaId) return { ...saved };
      }
      const matches = [];
      // Exact indexed recovery only. Exhaustion is required; exceeding 1,000
      // indexed records is a safe failure rather than an inferred first match.
      for (let offset = 0; offset < 1000; offset += 100) {
        const data = (
          await client.execute(
            'bindingTitles',
            { source: source.upstreamSourceId, offset },
            context,
          )
        ).mangas;
        if (
          !Array.isArray(data?.nodes) ||
          data.nodes.length > 100 ||
          typeof data.pageInfo?.hasNextPage !== 'boolean'
        )
          throw invalid();
        for (const row of data.nodes) {
          const title = checkedTitle(row, ref, source, raw);
          if (title) matches.push(title);
        }
        if (matches.length > 1) throw invalid();
        if (!data.pageInfo.hasNextPage) {
          if (matches.length !== 1) throw invalid();
          return api.rememberTitle(matches[0]);
        }
      }
      throw invalid();
    },
    async resolveEdition(titleRef, editionRef, context = {}) {
      if (!same(titleRef, editionRef?.title)) throw invalid();
      const binding = await api.resolveTitle(titleRef, context);
      const { source, raw } = await sourceFor(titleRef, context);
      if (canonicalKey(editionRef.upstreamKey, raw) !== editionRef.upstreamKey) throw invalid();
      const data = (
        await client.execute(
          'extensionChapters',
          { input: { id: Number(binding.localMangaId), fetchManga: true, fetchChapters: true } },
          context,
        )
      ).fetchMangaAndChapters;
      if (
        checkedTitle(data?.manga, titleRef, source, raw)?.localMangaId !== binding.localMangaId ||
        !Array.isArray(data.chapters)
      )
        throw invalid();
      const matches = data.chapters.filter(
        (row) =>
          String(row.mangaId) === binding.localMangaId &&
          canonicalKey(row.url, raw, row.realUrl) === editionRef.upstreamKey,
      );
      if (matches.length !== 1) throw invalid();
      const row = matches[0];
      return {
        ...binding,
        localChapterId: localInt(row.id),
        row,
        sourceRef: source,
        rawSource: raw,
      };
    },
  };
  return api;
}
