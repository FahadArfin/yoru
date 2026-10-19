import { api, readerRequest, titleOf } from './api';
import { animeRequest } from '../shared/anime-sources';
import { mediaReferenceSchema } from '../shared/media-reference';
import { decimalSourceId } from '../services/reader-bridge/suwayomi-operations.mjs';
import { getWatchPage, setWebMCPStatus } from './webmcp-state';

const mediaIdSchema = {
  ...mediaReferenceSchema,
  description: 'Yoru media ID returned by catalog search.',
};
const animeIdSchema = {
  type: 'string',
  pattern: '^mal-anime-[1-9][0-9]{0,8}$(?![\\s\\S])',
  description: 'MyAnimeList anime ID returned by catalog search.',
};
const episodeSchema = {
  type: 'integer',
  minimum: 1,
  maximum: 100000,
  description: 'Episode number in this anime season.',
};
const languageSchema = {
  type: 'string',
  enum: ['sub', 'dub'],
  description: 'Subtitled or dubbed audio; provider availability varies.',
};
function validate(args, properties, required) {
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw new Error('Tool input must be an object.');
  for (const key of required) if (args[key] === undefined) throw new Error('Missing ' + key + '.');
  for (const [key, value] of Object.entries(args)) {
    const rule = properties[key];
    if (!rule) throw new Error('Unknown argument: ' + key + '.');
    if (rule.type === 'integer' ? !Number.isInteger(value) : typeof value !== rule.type)
      throw new Error('Invalid ' + key + '.');
    if (
      typeof value === 'number' &&
      (!Number.isFinite(value) || value < rule.minimum || value > rule.maximum)
    )
      throw new Error('Invalid ' + key + '.');
    if (
      typeof value === 'string' &&
      ((rule.maxLength && value.length > rule.maxLength) ||
        (rule.pattern && !new RegExp(rule.pattern).test(value)))
    )
      throw new Error('Invalid ' + key + '.');
    if (rule.enum && !rule.enum.includes(value)) throw new Error('Invalid ' + key + '.');
  }
}
async function waitFor(predicate, signal) {
  const until = Date.now() + 10000;
  while (!predicate()) {
    signal.throwIfAborted();
    if (Date.now() > until)
      throw new Error('The page is still loading. Check page state before retrying.');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  signal.throwIfAborted();
}

export function setupWebMCP(navigate, { refreshLibrary, getReaderSelection } = {}) {
  const context = document.modelContext || navigator.modelContext;
  if (!context?.registerTool) {
    setWebMCPStatus({ supported: false, pending: false, registered: 0, failed: 0 });
    return () => {};
  }
  const lifecycle = new AbortController();
  const selectionKey = (value) =>
    JSON.stringify([
      value.owner,
      value.scope,
      value.destination,
      value.integrationMode,
      value.selectionFingerprint,
      value.expiresAt,
    ]);
  const currentSelection = () => {
    const selected = getReaderSelection?.();
    if (!selected?.ready || !selected.context?.selectionFingerprint)
      throw new Error('Wait for the current reader selection and destination confirmation.');
    if (Number.isFinite(selected.context.expiresAt) && selected.context.expiresAt <= Date.now())
      throw new Error('Reader choices expired. Refresh to sync your current choices.');
    return selected.context;
  };
  const assertCurrent = (selected) => {
    if (selectionKey(currentSelection()) !== selectionKey(selected))
      throw new Error('Reader selection changed. Retry in the current section.');
  };
  const read = async (path, signal, options = {}) => {
    const selected = currentSelection();
    const value = await readerRequest(path, { ...selected, ...options, signal });
    assertCurrent(selected);
    return value;
  };
  const write = async (path, body, signal) => {
    const selected = currentSelection();
    if (selected.scope === null) throw new Error('Wait for the current account session.');
    const params = new URLSearchParams({
      destination: selected.destination,
      integration: selected.integrationMode,
      selectionFingerprint: selected.selectionFingerprint,
    });
    const value = await api(path + '?' + params, {
      method: 'PUT',
      body: JSON.stringify(body),
      signal,
    });
    assertCurrent(selected);
    return value;
  };
  const names = new Set();
  const pending = [];
  let failed = 0;
  const report = (loading) => {
    if (!lifecycle.signal.aborted)
      setWebMCPStatus({ supported: true, pending: loading, registered: names.size, failed });
  };
  report(true);
  const result = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const register = (name, description, properties, required, readOnly, execute) => {
    const registration = (async () => {
      try {
        const registered = context.registerTool(
          {
            name,
            description,
            inputSchema: { type: 'object', properties, required, additionalProperties: false },
            annotations: {
              readOnlyHint: readOnly,
              untrustedContentHint: true,
              consequentialHint: false,
            },
            execute: async (args = {}, options = {}) => {
              try {
                const signal = options.signal
                  ? AbortSignal.any([lifecycle.signal, options.signal])
                  : lifecycle.signal;
                signal.throwIfAborted();
                validate(args, properties, required);
                const selected = currentSelection();
                const value = await execute(args, signal);
                signal.throwIfAborted();
                assertCurrent(selected);
                return result(value);
              } catch (error) {
                return {
                  ...result({
                    error: error.message,
                    code: error.name === 'AbortError' ? 'CANCELLED' : 'INVALID_OR_UNAVAILABLE',
                  }),
                  isError: true,
                };
              }
            },
          },
          { signal: lifecycle.signal },
        );
        // Legacy navigator registries register synchronously and ignore AbortSignal.
        // Track immediately so StrictMode cleanup can remove them before the next setup.
        names.add(name);
        await registered;
      } catch {
        names.delete(name);
        failed++;
      }
    })();
    pending.push(registration);
  };
  register(
    'yoru_search_catalog',
    'Search eligible anime, manga, manhwa and enabled native reading catalogs in the current section. Returns exact media IDs and provider metadata; availability is not reading proof.',
    {
      query: { type: 'string', maxLength: 200 },
      category: { type: 'string', enum: ['ALL', 'ANIME', 'MANGA', 'MANHWA'] },
      cursor: {
        type: 'string',
        maxLength: 2048,
        description: 'Opaque nextCursor from the same query and current selection. At most 2 KiB.',
      },
      sourceId: {
        type: 'string',
        pattern: '^(?:mangadex|weebcentral|suwayomi:-?[1-9][0-9]{0,18})$(?![\\s\\S])',
      },
      language: { type: 'string', maxLength: 64, pattern: '^[^\\x00-\\x1f\\x7f]+$(?![\\s\\S])' },
    },
    [],
    true,
    async ({ query = '', category = 'ALL', cursor, sourceId, language }, signal) => {
      const selected = currentSelection();
      if (
        sourceId !== undefined &&
        !['mangadex', 'weebcentral'].includes(sourceId) &&
        !(sourceId.startsWith('suwayomi:') && decimalSourceId(sourceId.slice(9)))
      )
        throw new Error('Choose an exact catalog source ID.');
      if (cursor && new TextEncoder().encode(cursor).byteLength > 2048)
        throw new Error('Reading cursor exceeds 2 KiB. Start a fresh search.');
      if (
        category === 'ANIME' &&
        (cursor !== undefined || sourceId !== undefined || language !== undefined)
      )
        throw new Error('Reading source, language and cursor filters require a reading category.');
      if (category === 'ANIME')
        return read('/api/catalog?' + new URLSearchParams({ search: query, category }), signal);
      const params = new URLSearchParams({ q: query, mode: query ? 'search' : 'popular' });
      if (cursor !== undefined) params.set('cursor', cursor);
      if (sourceId !== undefined) params.set('source', sourceId);
      if (language !== undefined) params.set('language', language);
      const reading = await read('/api/reader/browse?' + params, signal);
      if (category !== 'ALL')
        return {
          ...reading,
          destination: selected.destination,
          items: reading.items.filter((item) => item.category === category),
        };
      const anime =
        cursor || sourceId || language
          ? { items: [] }
          : await read(
              '/api/catalog?' + new URLSearchParams({ search: query, category: 'ANIME' }),
              signal,
            );
      return {
        ...reading,
        destination: selected.destination,
        items: [...anime.items, ...reading.items],
        total: null,
        totalIsEstimate: true,
      };
    },
  );
  register(
    'yoru_get_title',
    'Read a title and its metadata. Use yoru_get_sources to discover episode players.',
    { mediaId: mediaIdSchema },
    ['mediaId'],
    true,
    async ({ mediaId }, signal) => {
      const selected = currentSelection();
      return {
        ...(await read('/api/media/' + mediaId, signal)),
        destination: selected.destination,
      };
    },
  );
  register(
    'yoru_get_library',
    'Read the currently signed-in user’s saved library. Requires their existing session.',
    {},
    [],
    true,
    (_, signal) => read('/api/library', signal, { force: true, ttl: 0 }),
  );
  register(
    'yoru_update_library',
    'Save a requested favorite, status or progress change to the signed-in user’s library and refresh the visible list.',
    {
      mediaId: mediaIdSchema,
      status: {
        type: 'string',
        enum: ['planned', 'watching', 'reading', 'completed', 'paused', 'dropped'],
      },
      progress: { type: 'number', minimum: 0, maximum: 100000 },
      favorite: { type: 'boolean' },
    },
    ['mediaId'],
    false,
    async ({ mediaId, ...patch }, signal) => {
      if (!Object.keys(patch).length)
        throw new Error('Specify a status, progress or favorite change.');
      const saved = await write('/api/library/' + mediaId, patch, signal);
      await refreshLibrary?.();
      return saved;
    },
  );
  register(
    'yoru_list_rooms',
    'List public rooms and rooms visible to the current session. Does not join a room.',
    {},
    [],
    true,
    (_, signal) => read('/api/rooms', signal, { force: true, ttl: 0 }),
  );
  register(
    'yoru_open_title',
    'Open a title page. Changes page navigation only.',
    { mediaId: mediaIdSchema },
    ['mediaId'],
    false,
    async ({ mediaId }, signal) => {
      const selected = currentSelection();
      const media = await read('/api/media/' + mediaId, signal);
      signal.throwIfAborted();
      const path = (selected.destination === 'ara-ara' ? '/ara-ara' : '') + '/title/' + mediaId;
      navigate(path);
      await waitFor(
        () =>
          location.pathname === path &&
          document.title ===
            titleOf(media) + (selected.destination === 'ara-ara' ? ' · Ara Ara' : ' · Yoru'),
        signal,
      );
      assertCurrent(selected);
      return {
        opened: true,
        mediaId,
        destination: selected.destination,
        sourceRef: media.sourceRef,
        provenance: media.provenance,
      };
    },
  );
  const sourceProperties = {
    mediaId: animeIdSchema,
    episode: episodeSchema,
    language: languageSchema,
  };
  const sources = ({ mediaId, episode = 1, language = 'sub' }, signal) => {
    animeRequest(mediaId, episode, language);
    return read(
      '/api/media/' + mediaId + '/sources?' + new URLSearchParams({ episode, language }),
      signal,
    );
  };
  register(
    'yoru_get_sources',
    'Find automatic anime episode players and exact provider links. Provider-managed availability is not proof that video is playing.',
    sourceProperties,
    ['mediaId'],
    true,
    sources,
  );
  register(
    'yoru_open_episode',
    'Open an anime episode with a discovered source and language. Loads an external player; does not claim playback started or mark progress complete.',
    { ...sourceProperties, sourceId: { type: 'string', maxLength: 120 } },
    ['mediaId'],
    false,
    async (args, signal) => {
      const resolved = await sources(args, signal);
      const source = args.sourceId
        ? resolved.items.find((x) => x.id === args.sourceId)
        : resolved.items[0];
      if (!source) throw new Error('Source not found. Call yoru_get_sources for current choices.');
      signal.throwIfAborted();
      const selected = currentSelection();
      navigate(
        (selected.destination === 'ara-ara' ? '/ara-ara' : '') +
          '/watch/' +
          resolved.mediaId +
          '/' +
          resolved.episode +
          '?' +
          new URLSearchParams({ language: resolved.language, source: source.id }),
      );
      await waitFor(() => {
        const page = getWatchPage();
        return (
          page?.mediaId === resolved.mediaId &&
          page.unit === resolved.episode &&
          page.language === resolved.language &&
          page.source?.id === source.id
        );
      }, signal);
      return {
        opened: true,
        mediaId: resolved.mediaId,
        episode: resolved.episode,
        language: resolved.language,
        source,
        playbackStarted: false,
      };
    },
  );
  register(
    'yoru_get_page_state',
    'Read the current Yoru page, selected episode/source, and session status. Embedded video playback is not inferred from an iframe loading.',
    {},
    [],
    true,
    async (_, signal) => {
      const selected = currentSelection();
      const user = (await read('/api/auth/me', signal, { force: true, ttl: 0 })).user;
      return {
        path: location.pathname,
        ...getWatchPage(),
        destination: selected.destination,
        integrationMode: selected.integrationMode,
        user,
      };
    },
  );
  register(
    'yoru_select_source',
    'Switch the current watch page to a listed source. Does not accept arbitrary URLs or change saved account progress.',
    { sourceId: { type: 'string', maxLength: 120 } },
    ['sourceId'],
    false,
    async ({ sourceId }, signal) => {
      currentSelection();
      const page = getWatchPage();
      if (!page || page.category !== 'ANIME') throw new Error('Open an anime episode first.');
      const source = page.sources.find((x) => x.id === sourceId);
      if (!source) throw new Error('Source is not listed on this page.');
      const params = new URLSearchParams(location.search);
      params.set('source', sourceId);
      signal.throwIfAborted();
      navigate(page.path + '?' + params, { replace: true });
      await waitFor(() => getWatchPage()?.source?.id === sourceId, signal);
      return { selected: source, playbackStarted: false };
    },
  );
  Promise.allSettled(pending).then(() => report(false));
  return () => {
    lifecycle.abort();
    if (context === navigator.modelContext && context.unregisterTool) {
      for (const name of names) {
        try {
          context.unregisterTool(name);
        } catch {}
      }
    }
  };
}
