const cache = new Map();
const inflight = new Map();
const inflightSignals = new Map();
const cancellableInflight = new WeakSet();
export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    for (const key of ['reason', 'retryAfter', 'retryAt', 'restartRequired'])
      if (data[key] !== undefined) error[key] = data[key];
    const retryAfter = Number(response.headers.get('Retry-After'));
    if (
      error.retryAfter === undefined &&
      response.headers.has('Retry-After') &&
      Number.isFinite(retryAfter) &&
      retryAfter >= 0
    )
      error.retryAfter = retryAfter;
    throw error;
  }
  return data;
}
export const send = (path, body, method = 'POST') =>
  api(path, { method, body: JSON.stringify(body) });
export function cachedApi(path, force = false, { scope = '', ttl = 120000, signal } = {}) {
  signal?.throwIfAborted();
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
    : AbortSignal.timeout(60000);
  if (scope === null) return api(path, { signal: requestSignal });
  const key = `${scope}\n${path}`;
  const saved = cache.get(key);
  if (
    saved?.data?.providerUnavailable ||
    saved?.data?.totalIsEstimate ||
    saved?.data?.partial ||
    saved?.data?.state === 'offline'
  )
    ttl = Math.min(ttl, 10000);
  if (!force && saved && Date.now() - saved.time < ttl) return Promise.resolve(saved.data);
  if (inflight.has(key)) {
    // A hover preload and navigation own separate cancellation lifetimes.
    if (
      !signal &&
      !cancellableInflight.has(inflight.get(key)) &&
      !inflightSignals.get(key)?.aborted
    )
      return inflight.get(key);
    inflight.delete(key);
    inflightSignals.delete(key);
  }
  const request = api(path, { signal: requestSignal })
    .then((data) => {
      // A mutation may invalidate this response while it is still on the wire.
      if (inflight.get(key) === request && !requestSignal.aborted) {
        cache.delete(key);
        cache.set(key, { data, time: Date.now() });
        while (cache.size > 160) cache.delete(cache.keys().next().value);
      }
      return data;
    })
    .finally(() => {
      if (inflight.get(key) === request) {
        inflight.delete(key);
        inflightSignals.delete(key);
      }
    });
  inflight.set(key, request);
  inflightSignals.set(key, requestSignal);
  if (signal) cancellableInflight.add(request);
  return request;
}
export function peek(path, scope = '', maxAge = 120000) {
  if (scope === null) return undefined;
  const saved = cache.get(`${scope}\n${path}`);
  return saved && Date.now() - saved.time < maxAge ? saved.data : undefined;
}
export function invalidateApi(prefix) {
  for (const map of [cache, inflight, inflightSignals])
    for (const key of map.keys())
      if (key.slice(key.indexOf('\n') + 1).startsWith(prefix)) map.delete(key);
}
export function invalidateScopedApi() {
  for (const map of [cache, inflight, inflightSignals])
    for (const key of map.keys()) if (!key.startsWith('\n')) map.delete(key);
}
export const readingCacheScope = ({ owner, destination, integrationMode, selectionFingerprint }) =>
  owner === null
    ? null
    : JSON.stringify([
        'reading',
        owner || 'guest',
        destination,
        integrationMode,
        selectionFingerprint,
      ]);

function withoutPersonalRatings(value) {
  if (Array.isArray(value)) return value.map(withoutPersonalRatings);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === 'myRating' ? 0 : withoutPersonalRatings(item),
    ]),
  );
}
export async function readerRequest(
  path,
  {
    destination = 'yoru',
    integrationMode = 'all',
    scope = null,
    selectionFingerprint,
    expiresAt,
    signal,
    force = false,
    ttl = 30000,
  } = {},
) {
  if (!selectionFingerprint) throw new Error('Wait for the current reader selection to sync.');
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now())
    throw new Error('Reader choices expired. Refresh to sync your current choices.');
  signal?.throwIfAborted();
  const url = new URL(path, 'http://yoru.local');
  if (url.origin !== 'http://yoru.local' || !url.pathname.startsWith('/api/'))
    throw new Error('Invalid reader request.');
  url.searchParams.set('destination', destination);
  url.searchParams.set('integration', integrationMode);
  url.searchParams.set('selectionFingerprint', selectionFingerprint);
  const requestPath = `${url.pathname}${url.search}`;
  const data =
    scope === null
      ? await api(requestPath, {
          credentials: 'omit',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
            : AbortSignal.timeout(60000),
        })
      : await cachedApi(requestPath, force, {
          scope: readingCacheScope({
            owner: scope,
            destination,
            integrationMode,
            selectionFingerprint,
          }),
          ttl,
          signal,
        });
  signal?.throwIfAborted();
  return scope === null ? withoutPersonalRatings(data) : data;
}

const guestContextQueues = new Map();
const guestContexts = new Map();
const guestContextEpochs = new Map();
const guestContextPending = new Map();
export function syncGuestReaderContext(destination, selection, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if ((guestContextPending.get(destination) || 0) >= 16)
    return Promise.reject(
      Object.assign(new Error('Reader choices are busy. Try again shortly.'), {
        status: 503,
        reason: 'busy',
        retryAfter: 1,
      }),
    );
  const deadlineAt = Date.now() + 60000;
  guestContextPending.set(destination, (guestContextPending.get(destination) || 0) + 1);
  const epoch = guestContextEpochs.get(destination) || 0;
  const run = async () => {
    signal?.throwIfAborted();
    const remaining = () => {
      const duration = deadlineAt - Date.now();
      if (duration <= 0)
        throw new DOMException('Reader choices timed out. Refresh and try again.', 'TimeoutError');
      return duration;
    };
    if ((guestContextEpochs.get(destination) || 0) !== epoch)
      throw Object.assign(
        new Error('Reader choices changed in another tab. Refresh to use your current choices.'),
        { status: 409, concurrentChange: true },
      );
    const path = `/api/reader/context?destination=${encodeURIComponent(destination)}`;
    const readDeadline = AbortSignal.timeout(remaining());
    const current = await api(path, {
      signal: signal ? AbortSignal.any([signal, readDeadline]) : readDeadline,
    });
    const signature = JSON.stringify(selection);
    const saved = guestContexts.get(destination);
    if (
      saved?.signature === signature &&
      saved.context.revision === current.revision &&
      saved.context.selectionFingerprint === current.selectionFingerprint &&
      saved.context.expiresAt > Date.now() + 60000
    )
      return { ...current, expiresAt: saved.context.expiresAt };
    signal?.throwIfAborted();
    const mutationSignal = AbortSignal.timeout(remaining());
    try {
      // Dispatch time is conservative when a POST response arrives slowly. GETs
      // validate the cookie's revision but never renew the server row's lifetime.
      const postedAt = Date.now();
      const accepted = await api('/api/reader/context', {
        method: 'POST',
        // Once sent, this mutation remains the queue's barrier even if its UI
        // owner leaves. Server commit may outlive a canceled fetch otherwise.
        signal: mutationSignal,
        body: JSON.stringify({ destination, selection, expectedRevision: current.revision }),
      });
      const context = { ...accepted, expiresAt: postedAt + 25 * 60000 };
      guestContexts.set(destination, { signature, context });
      signal?.throwIfAborted();
      return context;
    } catch (error) {
      if (
        mutationSignal.aborted ||
        error.name === 'TimeoutError' ||
        [408, 504].includes(error.status)
      ) {
        // A deadline says nothing about whether the server committed. Discard
        // queued projections and require a fresh settings/context reconciliation.
        guestContextEpochs.set(destination, epoch + 1);
        guestContexts.delete(destination);
        throw Object.assign(
          new Error(
            'Reader choices could not finish syncing. Refresh to check your current choices.',
          ),
          { name: 'TimeoutError', status: 503, concurrentChange: true, restartRequired: true },
        );
      }
      if (error.status === 409) {
        guestContextEpochs.set(destination, epoch + 1);
        guestContexts.delete(destination);
        // Never replay a captured old projection after another tab changed the cookie context.
        error.context = await api(path, { signal: mutationSignal });
        error.concurrentChange = true;
        error.message =
          'Reader choices changed in another tab. Refresh to use your current choices.';
      }
      throw error;
    }
  };
  const previous = guestContextQueues.get(destination) || Promise.resolve();
  const request = previous.catch(() => {}).then(run);
  guestContextQueues.set(destination, request);
  const cleanup = () => {
    const pending = (guestContextPending.get(destination) || 1) - 1;
    if (pending) guestContextPending.set(destination, pending);
    else guestContextPending.delete(destination);
    if (guestContextQueues.get(destination) === request) guestContextQueues.delete(destination);
  };
  request.then(cleanup, cleanup);
  return request;
}
export const titleOf = (media) =>
  typeof media?.title === 'string'
    ? media.title
    : media?.title?.english || media?.title?.romaji || media?.titleEnglish || 'Untitled';
export const coverOf = (media) =>
  media?.cover || media?.coverImage?.extraLarge || media?.coverImage?.large || '/icon.svg';
export const bannerOf = (media) => media?.banner || media?.bannerImage || coverOf(media);
export const isAnime = (media) => media?.category === 'ANIME' || media?.type === 'ANIME';
export const kindOf = (media) => media?.category || media?.type || 'ANIME';
export const plainText = (value = '') =>
  String(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"');
export function ago(value) {
  const n = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  return !Number.isFinite(n) || n < 60
    ? 'just now'
    : n < 3600
      ? `${Math.floor(n / 60)}m ago`
      : n < 86400
        ? `${Math.floor(n / 3600)}h ago`
        : `${Math.floor(n / 86400)}d ago`;
}
export const scoreOf = (media) =>
  Number(media?.score || (media?.averageScore ? media.averageScore / 10 : 0));
export const itemsOf = (data) => (Array.isArray(data) ? data : data?.items || []);
export const safeLink = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};
