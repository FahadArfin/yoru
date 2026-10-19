import { createExternalCatalogStore } from './external-catalog-store.js';
import { assertMediaEligible, assertSourceEligible, publicReadingMedia } from './media-resolver.js';
import { createContinuationStore, restartRequired } from './reader-continuation.js';
import { refreshReaderSources, INVENTORY_FRESH_MS } from './reader-source-inventory.js';
import { apiError } from './validation.js';
import { withinReaderDeadline } from './reader-operation.js';

function selection(input, context) {
  const integration = input.integration || context.integrationMode;
  if (!['all', 'core', 'extensions'].includes(integration))
    throw apiError(400, 'Invalid reader integration.');
  const mode = input.mode || (input.q ? 'search' : 'popular');
  if (!['search', 'popular', 'latest'].includes(mode)) throw apiError(400, 'Invalid reading mode.');
  const q = String(input.q || '').trim();
  if (q.length > 200 || /[\x00-\x1f]/.test(q)) throw apiError(400, 'Invalid reading query.');
  const limit = input.limit == null ? 24 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw apiError(400, 'Invalid reading page size.');
  if (input.source && !/^(?:mangadex|weebcentral|suwayomi:[1-9]\d{0,24})$/.test(input.source))
    throw apiError(400, 'Invalid reading source.');
  return {
    integration,
    mode,
    q,
    language: input.language || context.language || null,
    source: input.source || null,
    limit,
  };
}
const eligibleSource = (s, c, p) => {
  try {
    assertSourceEligible(s, { ...c, integrationMode: p.integration }, { discovery: true });
    return (!p.source || p.source === s.id) && (!p.language || p.language === s.language);
  } catch {
    return false;
  }
};
const coreSources = ['mangadex', 'weebcentral'].map((id) => ({
  id,
  integration: 'core',
  providerKey: id === 'mangadex' ? 'MangaDex' : 'Weeb Central',
  language: 'en',
}));
const safeState = (sourceId, error, mode, now) => ({
  sourceId,
  state: 'unavailable',
  status: error?.status || 503,
  retryAt: error?.retryAt || new Date(now + 30000).toISOString(),
  operation: mode,
  reason: error?.reason || 'offline',
});
const key = (p) => JSON.stringify(p);
const effectiveSource = (observed, snapshot) =>
  observed.classification.rating === 'safe' && snapshot.classification?.rating !== 'safe'
    ? snapshot
    : observed;
function readingChoice(media) {
  return media.upstreamRef
    ? {
        mediaId: media.id,
        sourceRef: media.sourceRef,
        upstreamRef: media.upstreamRef,
        integration: media.sourceRef.integration,
        state:
          media.sourceRef.capabilities?.chapters === 'supported' &&
          media.sourceRef.capabilities?.pages === 'supported'
            ? 'ready'
            : 'unverified',
      }
    : null;
}
function publicSourceState(value, sourceId, operation, empty = false) {
  const statuses = [200, 400, 401, 403, 404, 409, 413, 422, 429, 502, 503, 504];
  const states = ['ready', 'empty', 'unsupported', 'unverified', 'unavailable', 'stale'];
  const reasons = ['auth-required', 'access-challenge', 'rate-limited', 'offline', 'removed'];
  return {
    sourceId,
    state: states.includes(value?.state) ? value.state : empty ? 'empty' : 'ready',
    status: statuses.includes(value?.status) ? value.status : 200,
    retryAt:
      typeof value?.retryAt === 'string' && Number.isFinite(Date.parse(value.retryAt))
        ? new Date(value.retryAt).toISOString()
        : null,
    operation,
    reason: reasons.includes(value?.reason) ? value.reason : null,
  };
}

async function aggregate(input, context, deps) {
  const params = selection(input, context),
    now = deps.now || Date.now,
    deadlineAt = now() + 12000;
  const continuation = deps.continuationStore || createContinuationStore(deps.db, deps),
    store = createExternalCatalogStore(deps.db, deps);
  const state = input.cursor
    ? await continuation.resume(input.cursor, context)
    : {
        version: 2,
        query: key(params),
        positions: {},
        pointer: 0,
        seen: [],
        representatives: {},
        pending: [],
        inventoryStart: null,
      };
  if (state.version !== 2 || state.query !== key(params)) throw restartRequired();
  const inventory = deps.currentSources
    ? { currentSources: deps.currentSources, sourceStates: [], complete: true, nextCursor: null }
    : await refreshReaderSources(context, deps, { deadlineAt, cursor: state.inventoryStart });
  const sources = [...coreSources, ...inventory.currentSources].filter((s) =>
    eligibleSource(s, context, params),
  );
  for (const s of sources) state.positions[s.id] ||= { page: 1, done: false, retryAt: null };
  let pointer = state.pointer % Math.max(1, sources.length),
    cycled = false;
  const candidates = [];
  for (let n = 0; n < sources.length && candidates.length < 4; n++) {
    const index = (pointer + n) % sources.length,
      s = sources[index],
      pos = state.positions[s.id];
    if (pos.done || (pos.retryAt && Date.parse(pos.retryAt) > now())) continue;
    if (s.integration === 'core' && !deps.coreSearch) {
      pos.done = true;
      continue;
    }
    if (s.capabilities?.[params.mode] === 'unsupported') {
      pos.done = true;
      continue;
    }
    candidates.push({ source: s, pos, sourceIndex: index });
  }
  if (!candidates.length && sources.length) cycled = true;
  const sourceStates = [...inventory.sourceStates],
    results = [],
    current = new Map(inventory.currentSources.map((s) => [s.id, s]));
  // Exactly two workers, four source-page operations, one common deadline.
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length && now() < deadlineAt && !context.signal?.aborted) {
      const index = cursor++,
        { source: s, pos, sourceIndex } = candidates[index];
      state.pointer = (sourceIndex + 1) % sources.length;
      if (sourceIndex === sources.length - 1) cycled = true;
      try {
        // Capture database authority before awaiting this source. Explicit null
        // guards a first observation against a concurrent source insertion.
        const expectedSource =
          s.integration === 'suwayomi' ? await store.getSourceAuthority(s.id) : undefined;
        const operation = { signal: context.signal, deadlineAt, priority: 'discovery' };
        const result = await withinReaderDeadline(
          operation,
          (op) =>
            s.integration === 'core'
              ? deps.coreSearch(
                  {
                    q: params.q,
                    category: 'MANGA',
                    page: pos.page,
                    limit: params.limit,
                    sort: params.mode === 'latest' ? 'newest' : 'trending',
                  },
                  op,
                )
              : deps.bridge.browse(
                  {
                    sourceId: s.id,
                    mode: params.mode,
                    query: params.q,
                    page: pos.page,
                    filters: [],
                  },
                  op,
                ),
          now,
        );
        if (!Array.isArray(result.items) || result.items.length > 1000)
          throw apiError(502, 'Invalid reading page.');
        if (result.sourceState?.state === 'unavailable') {
          const failure = publicSourceState(result.sourceState, s.id, params.mode);
          throw Object.assign(
            apiError(
              failure.status >= 400 ? failure.status : 503,
              'This reading source is temporarily unavailable.',
            ),
            { reason: failure.reason, retryAt: failure.retryAt },
          );
        }
        results[index] = { s, result, expectedSource };
      } catch (error) {
        const failure = safeState(s.id, error, params.mode, now());
        pos.retryAt = failure.retryAt;
        sourceStates.push(failure);
      }
    }
  }
  await Promise.all([worker(), worker()]);
  for (const entry of results.filter(Boolean)) {
    const { s, result } = entry,
      pos = state.positions[s.id];
    let expectedSource = entry.expectedSource,
      persistenceFailure;
    for (const item of result.items) {
      let media;
      try {
        if (s.integration === 'suwayomi') {
          if (
            item.sourceRef?.id !== s.id ||
            item.sourceRef.providerKey !== s.providerKey ||
            item.sourceRef.language !== s.language ||
            item.upstreamRef?.sourceId !== s.id
          )
            continue;
          // The freshly installed source rating wins over an older title/feed snapshot.
          const source = current.get(s.id);
          const observed = effectiveSource(
            { ...source, capabilities: item.sourceRef.capabilities },
            item.sourceRef,
          );
          current.set(s.id, observed);
          media = await store.rememberTitle({ ...item, sourceRef: observed }, { expectedSource });
          // Reuse only the proof produced by our own committed CAS. A fresh DB
          // read here could authorize overwriting a concurrent adult observation.
          expectedSource = media.sourceAuthority;
        } else media = { ...item, readingState: 'metadata-only', availableIntegrations: [] };
        assertMediaEligible(media, context);
      } catch (error) {
        if (error.status === 409) {
          persistenceFailure = error;
          break;
        }
        continue;
      }
      await deps.db.run(
        'INSERT INTO reader_feed_cache(media_id,payload,observed_at) VALUES(?,?,?) ON CONFLICT(media_id) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at',
        media.id,
        JSON.stringify(media),
        now(),
      );
      state.pending.push(media.id);
    }
    if (persistenceFailure) {
      const failure = safeState(s.id, persistenceFailure, params.mode, now());
      pos.retryAt = failure.retryAt;
      sourceStates.push(failure);
    } else {
      // A provider response whose source CAS failed is still a failed page.
      pos.page = result.nextPage ?? pos.page + 1;
      pos.done = !(result.hasMore ?? result.pageInfo?.hasNextPage ?? result.hasNextPage);
      pos.retryAt = null;
      sourceStates.push(
        publicSourceState(result.sourceState, s.id, params.mode, !result.items.length),
      );
    }
  }
  const items = [],
    updates = new Map();
  let updateChoices = 0;
  const seen = new Set(state.seen);
  const pending = [...new Set(state.pending)];
  state.pending = [];
  for (const id of pending) {
    if (items.length >= params.limit || updateChoices >= params.limit) {
      state.pending.push(id);
      continue;
    }
    if (seen.has(id)) continue;
    let media;
    try {
      if (id.startsWith('ext-manga-')) {
        media = await store.getTitle(id);
        const s = current.get(media.sourceRef.id);
        if (!s || !eligibleSource(s, context, params)) {
          state.pending.push(id);
          continue;
        }
        media = { ...media, sourceRef: effectiveSource(s, media.sourceRef) };
      } else {
        const row = await deps.db.get('SELECT payload FROM reader_feed_cache WHERE media_id=?', id);
        media = row && JSON.parse(row.payload);
      }
      assertMediaEligible(media, context);
    } catch {
      continue;
    }
    // Deduplication is strictly ID/evidence based. Names never establish equivalence.
    const equivalent = (await store.getEquivalences(id)).find((m) =>
      seen.has(m.leftId === id ? m.rightId : m.leftId),
    );
    if (equivalent) {
      const other = equivalent.leftId === id ? equivalent.rightId : equivalent.leftId;
      const representativeId = state.representatives[other];
      if (!representativeId) throw restartRequired();
      const existing = items.find((item) => item.id === representativeId);
      const choice = readingChoice(media);
      if (existing && choice) {
        existing.readingChoices = [...(existing.readingChoices || []), choice];
        existing.availableIntegrations = [
          ...new Set([...(existing.availableIntegrations || []), choice.integration]),
        ];
      } else if (choice) {
        // Send only newly observed eligible choices. Re-emitting an older card
        // would trust metadata/source safety from another inventory segment.
        const patch = updates.get(representativeId) || { id: representativeId, readingChoices: [] };
        patch.readingChoices.push(choice);
        updates.set(representativeId, patch);
        updateChoices++;
      }
      state.representatives[id] = representativeId;
      seen.add(id);
      continue;
    }
    seen.add(id);
    state.representatives[id] = id;
    items.push(
      id.startsWith('ext-')
        ? { ...publicReadingMedia(media, context), readingChoices: [readingChoice(media)] }
        : media,
    );
  }
  state.seen = [...seen];
  if ((cycled || !sources.length) && inventory.nextCursor) {
    state.inventoryStart = inventory.nextCursor;
    state.pointer = 0;
  } else if (cycled && inventory.complete) state.inventoryStart = null;
  const hasMore =
    !!state.pending.length ||
    !!inventory.nextCursor ||
    !inventory.complete ||
    Object.values(state.positions).some((position) => !position.done);
  const nextCursor = hasMore
    ? input.cursor
      ? await continuation.advance(input.cursor, state)
      : await continuation.start(context, state)
    : null;
  return {
    items,
    updates: [...updates.values()],
    nextCursor,
    hasMore,
    total: null,
    totalIsEstimate: true,
    sourceStates,
    selectionFingerprint: context.selectionFingerprint,
  };
}
export const getReadingDiscovery = (input = {}, context, deps) => aggregate(input, context, deps);
export const searchReadingCatalog = (input = {}, context, deps) =>
  aggregate({ ...input, mode: 'search' }, context, deps);

export async function getReadingSuggestions(input = {}, context, deps) {
  const p = selection(input, context),
    now = (deps.now || Date.now)();
  if (p.q.length < 2) return { items: [], selectionFingerprint: context.selectionFingerprint };
  const rows = await deps.db.all(
    'SELECT media_id,payload FROM reader_feed_cache ORDER BY observed_at DESC LIMIT 1000',
  );
  const items = [],
    store = createExternalCatalogStore(deps.db, deps);
  for (const row of rows) {
    let media = JSON.parse(row.payload);
    if (row.media_id.startsWith('ext-manga-')) {
      const current = await deps.db.get(
        'SELECT payload FROM reader_inventory_cache WHERE source_id=? AND observed_at>?',
        media.sourceRef.id,
        now - INVENTORY_FRESH_MS,
      );
      if (!current) continue;
      media = await store.getTitle(row.media_id);
      media.sourceRef = effectiveSource(JSON.parse(current.payload), media.sourceRef);
      if (!eligibleSource(media.sourceRef, context, p)) continue;
    } else if (
      p.integration === 'extensions' ||
      !coreSources.some((s) => eligibleSource(s, context, p))
    )
      continue;
    try {
      assertMediaEligible(media, context);
    } catch {
      continue;
    }
    if (
      ![media.title, media.titleEnglish, media.titleRomaji].some((t) =>
        String(t || '')
          .toLowerCase()
          .includes(p.q.toLowerCase()),
      )
    )
      continue;
    items.push(media.id.startsWith('ext-') ? publicReadingMedia(media, context) : media);
    if (items.length >= Math.min(12, p.limit)) break;
  }
  return { items, selectionFingerprint: context.selectionFingerprint };
}
