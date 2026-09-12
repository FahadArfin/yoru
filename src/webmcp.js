import { api, titleOf } from './api';
import { animeRequest } from '../shared/anime-sources';
import { getWatchPage, setWebMCPStatus } from './webmcp-state';

const mediaIdSchema = {
  type: 'string',
  pattern: '^mal-(anime|manga)-[1-9][0-9]{0,8}$',
  description: 'Yoru media ID returned by catalog search.',
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

export function setupWebMCP(navigate, { refreshLibrary } = {}) {
  const context = document.modelContext || navigator.modelContext;
  if (!context?.registerTool) {
    setWebMCPStatus({ supported: false, pending: false, registered: 0, failed: 0 });
    return () => {};
  }
  const lifecycle = new AbortController();
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
                return result(await execute(args, signal));
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
    'Search anime, manga and manhwa metadata. Returns media IDs for other Yoru tools.',
    {
      query: { type: 'string', maxLength: 200 },
      category: { type: 'string', enum: ['ALL', 'ANIME', 'MANGA', 'MANHWA'] },
    },
    [],
    true,
    ({ query = '', category = 'ALL' }, signal) =>
      api('/api/catalog?' + new URLSearchParams({ search: query, category }), { signal }),
  );
  register(
    'yoru_get_title',
    'Read a title and its metadata. Use yoru_get_sources to discover episode players.',
    { mediaId: mediaIdSchema },
    ['mediaId'],
    true,
    ({ mediaId }, signal) => api('/api/media/' + mediaId, { signal }),
  );
  register(
    'yoru_get_library',
    'Read the currently signed-in user’s saved library. Requires their existing session.',
    {},
    [],
    true,
    (_, signal) => api('/api/library', { signal }),
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
      const saved = await api('/api/library/' + mediaId, {
        method: 'PUT',
        body: JSON.stringify(patch),
        signal,
      });
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
    (_, signal) => api('/api/rooms', { signal }),
  );
  register(
    'yoru_open_title',
    'Open a title page. Changes page navigation only.',
    { mediaId: mediaIdSchema },
    ['mediaId'],
    false,
    async ({ mediaId }, signal) => {
      const media = await api('/api/media/' + mediaId, { signal });
      signal.throwIfAborted();
      navigate('/title/' + mediaId);
      await waitFor(
        () =>
          location.pathname === '/title/' + mediaId &&
          document.title === titleOf(media) + ' · Yoru',
        signal,
      );
      return { opened: true, mediaId };
    },
  );
  const sourceProperties = {
    mediaId: mediaIdSchema,
    episode: episodeSchema,
    language: languageSchema,
  };
  const sources = ({ mediaId, episode = 1, language = 'sub' }, signal) => {
    animeRequest(mediaId, episode, language);
    return api('/api/media/' + mediaId + '/sources?' + new URLSearchParams({ episode, language }), {
      signal,
    });
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
      navigate(
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
    async (_, signal) => ({
      path: location.pathname,
      ...getWatchPage(),
      user: (await api('/api/auth/me', { signal })).user,
    }),
  );
  register(
    'yoru_select_source',
    'Switch the current watch page to a listed source. Does not accept arbitrary URLs or change saved account progress.',
    { sourceId: { type: 'string', maxLength: 120 } },
    ['sourceId'],
    false,
    async ({ sourceId }, signal) => {
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
