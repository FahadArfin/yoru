import { apiError } from './validation.js';
import { readerBridge } from './reading-sources.js';
import { readerUpstreamError } from './reader-errors.js';
const invalid = () => {
  throw apiError(400, 'Invalid reading reference.');
};
function source(id) {
  if (typeof id !== 'string' || !/^suwayomi:[1-9]\d{0,24}$/.test(id)) invalid();
  return id;
}
function text(value, max = 2048) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    invalid();
  return value;
}
function title(ref) {
  if (!ref || typeof ref !== 'object') invalid();
  return {
    sourceId: source(ref.sourceId),
    upstreamKey: text(ref.upstreamKey),
    language: text(ref.language, 64),
  };
}
function edition(ref, owner) {
  if (!ref || typeof ref !== 'object') invalid();
  const t = title(ref.title);
  if (JSON.stringify(t) !== JSON.stringify(owner)) invalid();
  return { title: t, upstreamKey: text(ref.upstreamKey) };
}
async function bytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit)
    throw apiError(502, 'Reader response too large.');
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw apiError(502, 'Reader response too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
export function createExtensionGateway(options) {
  async function call(operation, payload, context = {}) {
    if (!(options.extensionsEnabled === true || options.extensionsEnabled === '1'))
      throw apiError(404, 'This title is unavailable.');
    const bridge = await readerBridge(options);
    if (!bridge) throw apiError(503, 'The reading server is offline.');
    try {
      const timeout = AbortSignal.timeout(
        Math.max(1, Math.min(12000, (context.deadlineAt || Date.now() + 12000) - Date.now())),
      );
      const response = await (options.fetchImpl || fetch)(`${bridge.url}/extension/${operation}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.bridgeKey}`,
        },
        body: JSON.stringify(payload),
        redirect: 'manual',
        signal: context.signal ? AbortSignal.any([context.signal, timeout]) : timeout,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw readerUpstreamError(
          response.status,
          response.headers.get('retry-after'),
          (options.now || Date.now)(),
        );
      }
      if (['cover', 'page'].includes(operation)) {
        const type = response.headers.get('content-type')?.split(';')[0];
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(type))
          throw apiError(502, 'The source did not return an image.');
        return {
          body: await bytes(response, 20 * 1024 ** 2),
          type,
          cached: response.headers.get('x-yoru-cache') === 'hit',
        };
      }
      return JSON.parse((await bytes(response, 4 * 1024 ** 2)).toString());
    } catch (error) {
      if (error.expose) throw error;
      throw apiError(503, 'This reading source is temporarily unavailable.');
    }
  }
  const titleCall = (operation, ref, context) => call(operation, { titleRef: title(ref) }, context);
  const editionCall = (operation, ref, chapter, context) => {
    const t = title(ref);
    return call(operation, { titleRef: t, editionRef: edition(chapter, t) }, context);
  };
  return {
    catalogs: (params = {}, context) =>
      call('catalogs', { cursor: params.cursor, limit: params.limit }, context),
    browse: (params, context) =>
      call(
        'browse',
        {
          sourceId: source(params.sourceId),
          mode: params.mode,
          query: params.query,
          page: params.page,
          filters: params.filters,
        },
        context,
      ),
    details: (ref, context) => titleCall('details', ref, context),
    cover: (ref, context) => titleCall('cover', ref, context),
    resolveLink: (params, context) =>
      call('resolve', { sourceId: source(params.sourceId), url: text(params.url) }, context),
    chapters: (ref, filters = {}, context) =>
      call('chapters', { titleRef: title(ref), filters }, context),
    chapter: (ref, e, context) => editionCall('chapter', ref, e, context),
    reader: (ref, e, context) => editionCall('reader', ref, e, context),
    page: (ref, e, page, context) => {
      if (!Number.isInteger(page) || page < 0 || page >= 500) invalid();
      const t = title(ref);
      return call('page', { titleRef: t, editionRef: edition(e, t), page }, context);
    },
  };
}
