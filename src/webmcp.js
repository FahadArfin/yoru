import { api, send } from './api';
export function setupWebMCP(navigate) {
  const context = document.modelContext || navigator.modelContext;
  if (!context?.registerTool) return () => {};
  const controller = new AbortController();
  const names = [];
  const result = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const register = (name, description, properties, required, readOnly, execute) => {
    try {
      const registered = context.registerTool(
        {
          name,
          description,
          inputSchema: { type: 'object', properties, required, additionalProperties: false },
          annotations: {
            readOnlyHint: readOnly,
            untrustedContentHint: true,
            consequentialHint: !readOnly,
          },
          execute: async (args) => {
            try {
              return result(await execute(args));
            } catch (error) {
              return { ...result({ error: error.message }), isError: true };
            }
          },
        },
        { signal: controller.signal },
      );
      Promise.resolve(registered).catch(() => {});
      names.push(name);
    } catch {
      /* The website remains usable when an experimental implementation differs. */
    }
  };
  register(
    'yoru_search_catalog',
    'Search Yoru anime, manga and manhwa metadata. Does not modify records.',
    {
      query: { type: 'string' },
      category: { type: 'string', enum: ['ALL', 'ANIME', 'MANGA', 'MANHWA'] },
    },
    [],
    true,
    ({ query = '', category = 'ALL' }) =>
      api(`/api/catalog?${new URLSearchParams({ search: query, category })}`),
  );
  register(
    'yoru_get_title',
    'Read a title and its external watch/read links using a Yoru media ID.',
    { mediaId: { type: 'string' } },
    ['mediaId'],
    true,
    ({ mediaId }) => api(`/api/media/${encodeURIComponent(mediaId)}`),
  );
  register(
    'yoru_get_library',
    'Read the currently signed-in user’s saved library. Requires their existing session.',
    {},
    [],
    true,
    () => api('/api/library'),
  );
  register(
    'yoru_update_library',
    'Save a title status, favorite, or progress to the signed-in user’s library. Call only when the user requests that change.',
    {
      mediaId: { type: 'string' },
      status: {
        type: 'string',
        enum: ['planned', 'watching', 'reading', 'completed', 'paused', 'dropped'],
      },
      progress: { type: 'integer', minimum: 0, maximum: 100000 },
      favorite: { type: 'boolean' },
    },
    ['mediaId'],
    false,
    ({ mediaId, ...patch }) => send(`/api/library/${encodeURIComponent(mediaId)}`, patch, 'PUT'),
  );
  register(
    'yoru_list_rooms',
    'List available public rooms and rooms visible to the signed-in user. No room is joined.',
    {},
    [],
    true,
    () => api('/api/rooms'),
  );
  register(
    'yoru_open_title',
    'Open a Yoru title page for the user. Does not post, join rooms, or modify account data.',
    { mediaId: { type: 'string' } },
    ['mediaId'],
    false,
    ({ mediaId }) => {
      navigate(`/title/${encodeURIComponent(mediaId)}`);
      return { opened: true, mediaId };
    },
  );
  return () => {
    controller.abort();
    if (context === navigator.modelContext && context.unregisterTool)
      names.forEach((name) => {
        try {
          context.unregisterTool(name);
        } catch {}
      });
  };
}
