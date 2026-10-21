import { apiError } from './validation.js';
import { parseMediaReference } from '../shared/media-reference.js';
import { readingProvider } from '../shared/catalog-preferences.js';
import { assertMediaEligible, assertSourceEligible } from '../shared/reading-eligibility.js';
import { createExternalCatalogStore, validateReaderSource } from './external-catalog-store.js';
import {
  materializeReadingEligibility,
  readingEligibilityColumns,
  readingEligibilityJoins,
} from './reading-account.js';
import { createContinuationStore, restartRequired } from './reader-continuation.js';
import { refreshReaderSources, INVENTORY_FRESH_MS } from './reader-source-inventory.js';
import { withinReaderDeadline } from './reader-operation.js';
import { readerUpstreamError, readerRetry } from './reader-errors.js';
import { sourceState } from '../services/reader-bridge/suwayomi-operations.mjs';

const WINDOW = 100;
const unavailable = () => apiError(404, 'This title is unavailable.');
function parentEligible(media, context, currentSources = []) {
  if (!media?.sourceRef) throw unavailable();
  // Recovery is the only place membership may be ignored for the parent. The
  // real context, candidate policy and inventory never receive this override.
  const provider = media.sourceRef.providerKey;
  const recovery = {
    ...context,
    overrides: {
      ...context.overrides,
      [provider]: { ...context.overrides?.[provider], [context.destination]: true },
    },
  };
  assertMediaEligible(media, recovery);
  for (const observed of currentSources.filter((s) => s.id === media.sourceRef.id)) {
    if (
      !['id', 'integration', 'upstreamSourceId', 'providerKey', 'language'].every(
        (key) => observed[key] === media.sourceRef[key],
      )
    )
      throw unavailable();
    assertMediaEligible({ ...media, sourceRef: observed }, recovery);
  }
}
async function parentProof(store, id, context, deps, currentSources, now) {
  const media = await store.getTitle(id);
  parentEligible(media, context);
  const cached = await deps.db.get(
    'SELECT payload FROM reader_inventory_cache WHERE source_id=? AND observed_at>?',
    media.sourceRef.id,
    now - INVENTORY_FRESH_MS,
  );
  let sources = currentSources;
  if (cached) {
    let observed;
    try {
      observed = validateReaderSource(JSON.parse(cached.payload));
    } catch {
      throw unavailable();
    }
    sources = [...sources, observed];
  }
  parentEligible(media, context, sources);
}
function sourceCopy(source) {
  return Object.fromEntries(
    [
      'id',
      'integration',
      'upstreamSourceId',
      'providerKey',
      'language',
      'classification',
      'capabilities',
      'bridgeInstance',
    ].map((key) => [key, source[key]]),
  );
}
function coreSource(id, context, now) {
  return {
    id,
    integration: 'core',
    upstreamSourceId: null,
    providerKey: readingProvider(id),
    language: context.language || 'en',
    classification: {
      rating: 'unknown',
      provenance: { sourceField: null, value: null, checkedAt: new Date(now).toISOString() },
    },
    capabilities: Object.fromEntries(
      ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map((key) => [
        key,
        'unverified',
      ]),
    ),
    bridgeInstance: null,
  };
}
function safeStates(states, now) {
  return states.map((value) => {
    const failure = readerUpstreamError(Number(value.status));
    const date = typeof value.retryAt === 'string' ? Date.parse(value.retryAt) : NaN;
    Object.assign(
      failure,
      Number.isFinite(date) ? readerRetry(new Date(date).toUTCString(), now) : {},
    );
    return sourceState(null, 'catalogs', 'unavailable', failure);
  });
}
async function candidateRows(db, ids) {
  if (!ids.length) return [];
  return db.all(
    `WITH a AS (SELECT value AS media_id FROM json_each(?)) SELECT ${readingEligibilityColumns}
    FROM a ${readingEligibilityJoins}`,
    JSON.stringify(ids),
  );
}

/** Metadata-free recovery references for an existing native title. No title
 * provider is queried; source inventory is refreshed once for this scan window.
 * Continuations retain only canonical scan/source positions, never title data.
 */
export async function getReaderAlternatives(input, context, deps) {
  const id = input?.id;
  if (parseMediaReference(id)?.kind !== 'extension-manga') throw unavailable();
  const now = deps.now || Date.now,
    startedAt = now(),
    deadlineAt = startedAt + 12000;
  const continuation = createContinuationStore(deps.db, deps);
  const state = input.cursor
    ? await continuation.resume(input.cursor, context)
    : {
        kind: 'reader-alternatives',
        version: 1,
        mediaId: id,
        afterId: null,
        sourceCursor: null,
        pendingCore: false,
        emitted: false,
      };
  if (
    state.kind !== 'reader-alternatives' ||
    state.version !== 1 ||
    state.mediaId !== id ||
    typeof state.pendingCore !== 'boolean' ||
    typeof state.emitted !== 'boolean' ||
    (state.afterId !== null && !parseMediaReference(state.afterId)) ||
    (state.sourceCursor !== null &&
      (typeof state.sourceCursor !== 'string' || Buffer.byteLength(state.sourceCursor) > 2048))
  )
    throw restartRequired();
  const store = createExternalCatalogStore(deps.db, deps);
  await parentProof(store, id, context, deps, [], now());
  // Every edge was admitted by the authoritative store's exact equivalence
  // validator. This bounded query reads the same table without unbounded fanout.
  const mappings = await deps.db.all(
    `SELECT CASE WHEN left_id=? THEN right_id ELSE left_id END AS media_id
    FROM reader_equivalences WHERE (left_id=? OR right_id=?)
    AND (? IS NULL OR (CASE WHEN left_id=? THEN right_id ELSE left_id END)>?)
    ORDER BY media_id LIMIT ?`,
    id,
    id,
    id,
    state.afterId,
    id,
    state.afterId,
    WINDOW + 1,
  );
  const hasMore = mappings.length > WINDOW,
    window = mappings.slice(0, WINDOW),
    ids = window.map((row) => row.media_id);
  const before = await candidateRows(deps.db, ids);
  const nativeCandidate = before.some((row) => {
    if (!row.native_id || !row.source_id) return false;
    try {
      assertSourceEligible(
        { id: row.source_id, integration: row.integration, providerKey: row.provider_key },
        context,
        { discovery: true },
      );
      return true;
    } catch {
      return false;
    }
  });
  let inventory = { currentSources: [], complete: true, nextCursor: null, sourceStates: [] };
  if (nativeCandidate)
    inventory = await (deps.refreshSources || refreshReaderSources)(context, deps, {
      deadlineAt,
      maxOperations: 4,
      cursor: state.sourceCursor,
    });
  const coreEnabled = ['mangadex', 'weebcentral'].some((value) => {
    try {
      assertSourceEligible(coreSource(value, context, now()), context, { discovery: true });
      return true;
    } catch {
      return false;
    }
  });
  const coreIds = coreEnabled
    ? ids.filter((value) => parseMediaReference(value)?.kind === 'manga')
    : [];
  let core = [],
    unknownCore = false;
  if (coreIds.length) {
    if (deps.coreAccountMedia) {
      try {
        core = await withinReaderDeadline(
          { signal: context.signal, deadlineAt, priority: 'interactive' },
          () => deps.coreAccountMedia(coreIds),
          now,
        );
      } catch (error) {
        if (context.signal?.aborted) throw error;
        unknownCore = true;
      }
    } else unknownCore = true;
    const known = new Set(core.map((item) => item.id));
    unknownCore ||= coreIds.some((value) => !known.has(value));
  }
  // Read canonical policy after all waits. New restrictive source authority must
  // win over a safe inventory response that started earlier in this request.
  await parentProof(store, id, context, deps, inventory.currentSources, now());
  const rows = await candidateRows(deps.db, ids);
  const projected = materializeReadingEligibility(rows, context, {
    coreMedia: core,
    currentSources: inventory.currentSources,
    maxItems: WINDOW + 1,
    sourceCheckSince: startedAt,
  });
  const choices = new Map(),
    canonicalById = new Map(rows.map((row) => [row.media_id, row]));
  for (const media of projected.mediaById.values()) {
    const sources = media.sourceRef
      ? [media.sourceRef]
      : ['mangadex', 'weebcentral'].map((value) => coreSource(value, context, now()));
    for (const source of sources) {
      try {
        // Canonical source restrictions apply even when observed before this
        // request. Fresh SAFE inventory cannot erase that independent proof.
        if (media.sourceRef)
          assertMediaEligible(
            {
              ...media,
              sourceRef: {
                ...source,
                classification: JSON.parse(canonicalById.get(media.id).source_version),
              },
            },
            context,
          );
        assertSourceEligible(source, context, { discovery: true });
      } catch {
        continue;
      }
      const choice = {
        mediaId: media.id,
        sourceRef: sourceCopy(source),
        upstreamRef: media.upstreamRef || null,
        integration: source.integration,
        state: media.upstreamRef ? 'unverified' : 'unresolved',
      };
      choices.set(`${media.id}\0${source.id}`, choice);
    }
  }
  const pendingCore = state.pendingCore || unknownCore;
  const incomplete = !inventory.complete || hasMore || pendingCore;
  if (!choices.size && !incomplete && !state.emitted) throw unavailable();
  let nextCursor = null;
  if (incomplete) {
    // Inventory continuation preserves this exact mapping window. A finished
    // window advances its canonical keyset. One boolean preserves earlier
    // missing core proof; terminal explicit retry starts a fresh bounded scan.
    const next = {
      ...state,
      afterId: !inventory.complete
        ? state.afterId
        : hasMore
          ? window.at(-1).media_id
          : pendingCore
            ? null
            : state.afterId,
      sourceCursor: !inventory.complete ? inventory.nextCursor : null,
      pendingCore: (!inventory.complete || hasMore) && pendingCore,
      // A full proof retry starts a new scan; ordinary source/mapping pages
      // retain only whether this scan has already emitted an eligible choice.
      emitted:
        !(!hasMore && inventory.complete && pendingCore) && (state.emitted || choices.size > 0),
    };
    nextCursor = input.cursor
      ? await continuation.advance(input.cursor, next)
      : await continuation.start(context, next);
  }
  const sourceStates = safeStates(inventory.sourceStates || [], now());
  if (pendingCore)
    sourceStates.push({
      sourceId: null,
      state: 'unverified',
      status: null,
      retryAt: null,
      operation: 'alternatives',
      reason: null,
    });
  return { choices: [...choices.values()], incomplete, sourceStates, nextCursor };
}
