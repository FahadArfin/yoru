import { apiError } from './validation.js';
import {
  assertMediaEligible,
  publicReadingMedia,
  resolveMedia,
  resolveReadingEdition,
} from './media-resolver.js';
import { resolveReaderContext } from './reader-context.js';
import { parseMediaReference, parseEditionReference } from '../shared/media-reference.js';
import { createContinuationStore, restartRequired } from './reader-continuation.js';
import { refreshReaderSources } from './reader-source-inventory.js';

// Private snapshots are durable account data, never discovery/safety authority.
export const readingAccountSchema = `CREATE TABLE IF NOT EXISTS reading_account_snapshots (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, media_id TEXT NOT NULL, record_kind TEXT NOT NULL,
 destination TEXT NOT NULL, metadata TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,media_id,record_kind),
 CONSTRAINT reading_account_kind CHECK(record_kind IN ('library','resume')),
 CONSTRAINT reading_account_destination CHECK(destination IN ('yoru','ara-ara'))
);`;
const MAX_RECORDS = 5000;
const guard = (c) => (c.sessionHash ? { userId: c.userId, sessionHash: c.sessionHash } : undefined);
export const accountRevisionStatement = (c) => ({
  sql: "SELECT json(CASE WHEN COALESCE((SELECT revision FROM reader_settings WHERE user_id=?),0)=? THEN 'true' ELSE 'reader_preferences_changed' END)",
  values: [c.userId, c.revision],
});
export async function accountAtomic(context, statements, deps, { media } = {}) {
  const checks = [accountRevisionStatement(context)];
  if (media && parseMediaReference(media.id)?.kind === 'extension-manga') {
    const source = media.sourceRef,
      ref = media.upstreamRef;
    if (!source || !ref) throw apiError(409, 'Title eligibility changed. Reload and try again.');
    const scalar = (value) => (typeof value === 'boolean' ? Number(value) : (value ?? null));
    checks.push({
      sql: `SELECT json(CASE WHEN EXISTS(SELECT 1 FROM external_media em JOIN reader_sources rs ON rs.id=em.source_id
      WHERE em.id=? AND em.source_id=? AND em.upstream_key=? AND em.language=? AND rs.integration='suwayomi'
      AND rs.upstream_source_id=? AND rs.provider_key=? AND rs.language=?
      AND json_extract(rs.classification,'$.rating') IS ? AND json_extract(em.classification,'$.rating') IS ?
      AND json_extract(em.classification,'$.provenance.sourceField') IS ? AND json_extract(em.metadata,'$.isAdult') IS ?)
      THEN 'true' ELSE 'reader_media_changed' END)`,
      values: [
        media.id,
        source.id,
        ref.upstreamKey,
        ref.language,
        source.upstreamSourceId,
        source.providerKey,
        source.language,
        source.classification?.rating ?? null,
        media.classification?.rating ?? null,
        media.classification?.provenance?.sourceField ?? null,
        scalar(media.isAdult),
      ],
    });
  }
  try {
    return (await deps.db.atomic([...checks, ...statements], guard(context))).slice(checks.length);
  } catch (error) {
    if (/reader_preferences_changed|malformed JSON/i.test(error.message))
      throw apiError(409, 'Reader preferences or title eligibility changed. Reload and try again.');
    throw error;
  }
}
export async function currentAccountContext(context, deps) {
  if (!context.userId) throw apiError(401, 'Sign in to continue.');
  if (!context.sessionHash) return context;
  return resolveReaderContext(
    { destination: context.destination, language: context.language },
    {
      db: deps.db,
      userId: context.userId,
      sessionHash: context.sessionHash,
      extensionsEnabled: context.extensionsEnabled,
      signal: context.signal,
    },
  );
}
const native = (id) => parseMediaReference(id)?.kind === 'extension-manga';
function sameSource(a, b) {
  return ['id', 'integration', 'providerKey', 'language', 'upstreamSourceId'].every(
    (k) => a?.[k] === b?.[k],
  );
}
function storedNative(row, currentSources) {
  if (!row.native_id || !row.source_id) return null;
  const stored = {
    id: row.source_id,
    integration: row.integration,
    upstreamSourceId: row.upstream_source_id,
    providerKey: row.provider_key,
    language: row.source_language,
  };
  const source = currentSources.find((s) => s.id === row.source_id);
  if (!source || !sameSource(source, stored)) return null;
  const metadata = JSON.parse(row.native_metadata),
    classification = JSON.parse(row.title_classification);
  return {
    ...metadata,
    id: row.media_id,
    category: metadata.category === 'MANHWA' ? 'MANHWA' : 'MANGA',
    malId: null,
    idMal: null,
    sourceRef: source,
    upstreamRef: {
      sourceId: source.id,
      upstreamKey: row.upstream_key,
      language: row.title_language,
    },
    classification,
    provenance: classification.provenance,
    availableIntegrations: ['suwayomi'],
  };
}
const joins = `LEFT JOIN external_media em ON em.id=a.media_id LEFT JOIN reader_sources rs ON rs.id=em.source_id`;
const columns = `a.*,em.id AS native_id,em.source_id,em.upstream_key,em.language AS title_language,em.classification AS title_classification,em.metadata AS native_metadata,em.updated_at AS title_version,rs.integration,rs.upstream_source_id,rs.provider_key,rs.language AS source_language,rs.classification AS source_version,rs.updated_at AS source_observed_at`;
export const readingEligibilityJoins = joins;
export const readingEligibilityColumns = columns;
export const readingEligibilityPredicate = `(em.id IS NULL OR (em.updated_at=json_extract(policy.value,'$.titleVersion') AND json_extract(rs.classification,'$.rating') IS json_extract(policy.value,'$.sourceRating') AND json_extract(em.classification,'$.rating') IS json_extract(policy.value,'$.titleRating') AND json_extract(em.classification,'$.provenance.sourceField') IS json_extract(policy.value,'$.titleField') AND json_extract(em.metadata,'$.isAdult') IS json_extract(policy.value,'$.adultValue')))`;

/** Shared bounded projection for account/social candidate batches. Fetch current
 * inventory once at the request boundary, then pass the same proof to every batch.
 * SQL aliases are a (records), em/rs (canonical metadata), policy (json_each).
 */
export function materializeReadingEligibility(
  rows,
  context,
  { currentSources = [], coreMedia = [], maxItems = 5001, sourceCheckSince } = {},
) {
  if (
    rows.length > MAX_RECORDS ||
    !Number.isInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > MAX_RECORDS + 1
  )
    throw apiError(400, 'Invalid eligibility batch.');
  const coreById = new Map(coreMedia.map((media) => [media.id, media])),
    mediaById = new Map(),
    policyById = new Map();
  let lastScanned = null,
    scannedCount = 0;
  for (const row of rows) {
    lastScanned = row;
    scannedCount++;
    const item = native(row.media_id)
      ? storedNative(row, currentSources)
      : coreById.get(row.media_id);
    try {
      assertMediaEligible(item, context);
      if (
        native(row.media_id) &&
        sourceCheckSince !== undefined &&
        Date.parse(row.source_observed_at) >= sourceCheckSince
      ) {
        // A concurrent details response may establish newer restrictive evidence
        // while inventory is waiting. Never overwrite it with that older response;
        // the same shared policy preserves independent title ratings.
        assertMediaEligible(
          {
            ...item,
            sourceRef: { ...item.sourceRef, classification: JSON.parse(row.source_version) },
          },
          context,
        );
      }
    } catch {
      continue;
    }
    mediaById.set(row.media_id, native(row.media_id) ? publicReadingMedia(item, context) : item);
    policyById.set(row.media_id, {
      id: row.media_id,
      titleVersion: row.title_version,
      sourceRating: row.source_version ? JSON.parse(row.source_version).rating : null,
      titleRating: item.classification?.rating ?? null,
      titleField: item.classification?.provenance?.sourceField ?? null,
      adultValue: item.isAdult ?? null,
    });
    if (policyById.size >= maxItems) break;
  }
  return { mediaById, eligible: [...policyById.values()], lastScanned, scannedCount };
}
async function pagination(params, context, table, deps) {
  const limit =
    params.limit === undefined ? (table === 'library' ? 5000 : 100) : Number(params.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECORDS)
    throw apiError(400, 'Invalid account page size.');
  let after = null;
  if (params.cursor) {
    const state = await createContinuationStore(deps.db, deps).resume(params.cursor, context);
    if (
      state.kind !== 'account-list' ||
      state.table !== table ||
      state.limit !== limit ||
      typeof state.after?.id !== 'string' ||
      !['string', 'number'].includes(typeof state.after?.updatedAt)
    )
      throw restartRequired();
    after = state.after;
  }
  return { limit, after };
}
async function list(table, context, params, deps) {
  const before = context;
  const clock = deps.now || Date.now,
    startedAt = clock(),
    deadlineAt = startedAt + 12000;
  await pagination(params, context, table, deps);
  let inventory = { currentSources: [], complete: true, sourceStates: [], nextCursor: null };
  let sourceCursor = null;
  if (params.sourceCursor) {
    const state = await createContinuationStore(deps.db, deps).resume(params.sourceCursor, context);
    if (state.kind !== 'account-inventory' || state.table !== table) throw restartRequired();
    sourceCursor = state.upstream;
  }
  if (
    context.extensionsEnabled &&
    (await deps.db.get(
      `SELECT 1 FROM ${table} a JOIN external_media em ON em.id=a.media_id WHERE a.user_id=? LIMIT 1`,
      context.userId,
    ))
  ) {
    try {
      const refresh = deps.refreshSources || refreshReaderSources;
      inventory = await refresh(context, deps, {
        deadlineAt,
        cursor: sourceCursor,
      });
    } catch {
      inventory = {
        currentSources: [],
        complete: false,
        sourceStates: [{ state: 'unavailable', reason: 'offline' }],
        nextCursor: null,
      };
    }
  }
  context = await currentAccountContext(context, deps);
  if (
    (params.cursor || params.sourceCursor) &&
    context.selectionFingerprint !== before.selectionFingerprint
  )
    throw restartRequired();
  const { limit, after } = await pagination(params, context, table, deps);
  const media = new Map(),
    eligible = [];
  let scanAfter = after,
    lastScanned = null,
    exhausted = false,
    budgetExhausted = false;
  // Each SQL/cache batch is bounded; only limit+1 verified eligible snapshots
  // survive materialization. A deadline/20-batch ceiling yields a truthful keyset
  // continuation rather than starving all older rows behind an arbitrary first cap.
  for (let batch = 0; batch < 20; batch++) {
    if (context.signal?.aborted) throw apiError(408, 'Account view cancelled.');
    if (batch > 0 && clock() >= deadlineAt) {
      budgetExhausted = true;
      break;
    }
    const rows = await deps.db.all(
      `SELECT ${columns} FROM ${table} a ${joins} WHERE a.user_id=? ${scanAfter ? 'AND (a.updated_at<? OR (a.updated_at=? AND a.media_id<?))' : ''} ORDER BY a.updated_at DESC,a.media_id DESC LIMIT ?`,
      context.userId,
      ...(scanAfter ? [scanAfter.updatedAt, scanAfter.updatedAt, scanAfter.id] : []),
      MAX_RECORDS,
    );
    if (!rows.length) {
      exhausted = true;
      break;
    }
    const core = await deps.coreAccountMedia(
      rows.filter((r) => !native(r.media_id)).map((r) => r.media_id),
      rows.filter((r) => r.imported_metadata).map((r) => JSON.parse(r.imported_metadata)),
    );
    const projected = materializeReadingEligibility(rows, context, {
      currentSources: inventory.currentSources,
      coreMedia: core,
      maxItems: limit + 1 - eligible.length,
      sourceCheckSince: startedAt,
    });
    lastScanned = projected.lastScanned;
    for (const [id, item] of projected.mediaById) media.set(id, item);
    eligible.push(...projected.eligible);
    if (eligible.length >= limit + 1) break;
    if (rows.length < MAX_RECORDS) {
      exhausted = true;
      break;
    }
    scanAfter = { updatedAt: lastScanned.updated_at, id: lastScanned.media_id };
    if (batch === 19) budgetExhausted = true;
  }
  // Policy is evaluated once by the shared JS assertion on verified current metadata,
  // then materialized into SQL BEFORE its keyset ordering and LIMIT. Unknowns never enter.
  const [selected] = await accountAtomic(
    context,
    [
      {
        sql: `SELECT a.* FROM ${table} a ${joins}
 JOIN json_each(?) policy ON json_extract(policy.value,'$.id')=a.media_id
 WHERE a.user_id=? AND ${readingEligibilityPredicate}
 ${after ? 'AND (a.updated_at<? OR (a.updated_at=? AND a.media_id<?))' : ''}
 ORDER BY a.updated_at DESC,a.media_id DESC LIMIT ?`,
        values: [
          JSON.stringify(eligible),
          context.userId,
          ...(after ? [after.updatedAt, after.updatedAt, after.id] : []),
          limit + 1,
        ],
      },
    ],
    deps,
  );
  const hasMore = selected.length > limit || !exhausted,
    page = selected.slice(0, limit),
    last = selected.length > limit ? page.at(-1) : lastScanned;
  const items = page.map((r) =>
    table === 'library'
      ? libraryAccountShape(r, media.get(r.media_id))
      : {
          ...JSON.parse(r.payload),
          ...resumeMetadata(media.get(r.media_id), context),
          mediaId: r.media_id,
        },
  );
  const cursors = createContinuationStore(deps.db, deps);
  const nextCursor = hasMore
    ? await cursors.start(context, {
        kind: 'account-list',
        table,
        limit,
        after: { updatedAt: last.updated_at, id: last.media_id },
      })
    : null;
  const nextSourceCursor = inventory.nextCursor
    ? await cursors.start(context, {
        kind: 'account-inventory',
        table,
        upstream: inventory.nextCursor,
      })
    : null;
  await accountAtomic(context, [], deps);
  return {
    items,
    hasMore,
    nextCursor,
    sourceStates: inventory.sourceStates,
    inventoryComplete: inventory.complete,
    sourceCursor: nextSourceCursor,
    recordsComplete: !budgetExhausted,
    scanState: budgetExhausted ? 'incomplete' : 'ready',
    selectionFingerprint: context.selectionFingerprint,
    preferencesChanged: before.selectionFingerprint !== context.selectionFingerprint,
  };
}
export const listReadingLibrary = (context, params = {}, deps) =>
  list('library', context, params, deps);
export const listReadingResume = (context, params = {}, deps) =>
  list('resume_progress', context, params, deps);
export const libraryAccountShape = (r, media) => ({
  mediaId: r.media_id,
  media,
  favorite: !!r.favorite,
  status: r.status,
  progress: r.progress,
  score: r.score,
  updatedAt: r.updated_at,
});
export function resumeMetadata(media, context) {
  return {
    title: media.title,
    cover: media.cover || '',
    category: media.category,
    destination: context.destination,
    ...(native(media.id)
      ? {
          sourceRef: media.sourceRef,
          upstreamRef: media.upstreamRef,
          classification: media.classification,
          provenance: media.provenance,
          malId: null,
          idMal: null,
        }
      : {}),
  };
}
export function accountSnapshotStatement(context, media, kind = 'library') {
  const snapshot = {};
  for (const key of [
    'id',
    'title',
    'titleEnglish',
    'titleRomaji',
    'titleJapanese',
    'category',
    'type',
    'format',
    'status',
    'isAdult',
    'malId',
    'idMal',
    'sourceRef',
    'upstreamRef',
    'classification',
    'provenance',
    'cover',
    'coverImage',
  ])
    if (Object.hasOwn(media, key)) snapshot[key] = media[key];
  const metadata = JSON.stringify(snapshot);
  if (Buffer.byteLength(metadata) > 131072)
    throw apiError(413, 'Saved title metadata is too large.');
  return {
    sql: `INSERT INTO reading_account_snapshots(user_id,media_id,record_kind,destination,metadata,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,media_id,record_kind) DO UPDATE SET destination=excluded.destination,metadata=excluded.metadata,updated_at=excluded.updated_at`,
    values: [
      context.userId,
      media.id,
      kind,
      context.destination,
      metadata,
      new Date().toISOString(),
    ],
  };
}
export async function resolveAccountMedia(id, chapterId, context, deps) {
  if (native(id) && chapterId && parseEditionReference(chapterId)?.kind !== 'extension')
    throw apiError(404, 'This chapter is unavailable for this title.');
  let media = await resolveMedia(id, context, deps);
  if (parseEditionReference(chapterId)?.kind === 'extension')
    await resolveReadingEdition(id, chapterId, context, { ...deps, bridge: null });
  context = await currentAccountContext(context, deps);
  // Provider detail waits can overlap logout or preference changes. Re-read exact saved
  // authority under the new context; browse mode remains irrelevant to a saved edition.
  media = await resolveMedia(id, context, { ...deps, bridge: null });
  return { context, media };
}
export async function exportReadingAccount(context, deps) {
  context = await currentAccountContext(context, deps);
  const [library, resume, snapshots] = await accountAtomic(
    context,
    [
      {
        sql: 'SELECT * FROM library WHERE user_id=? ORDER BY updated_at DESC,media_id DESC',
        values: [context.userId],
      },
      {
        sql: 'SELECT * FROM resume_progress WHERE user_id=? ORDER BY updated_at DESC,media_id DESC',
        values: [context.userId],
      },
      { sql: 'SELECT * FROM reading_account_snapshots WHERE user_id=?', values: [context.userId] },
    ],
    deps,
  );
  const saved = new Map(snapshots.map((r) => [`${r.record_kind}:${r.media_id}`, r]));
  const identity = (id) => {
    const ref = parseMediaReference(id),
      malId = ['anime', 'manga'].includes(ref?.kind) ? Number(id.split('-').at(-1)) : null;
    return { kind: ref?.kind || 'unknown', id, malId, idMal: malId };
  };
  const shape = (r, kind) => {
    const snapshot = saved.get(`${kind}:${r.media_id}`),
      metadata = snapshot ? JSON.parse(snapshot.metadata) : null;
    return {
      mediaId: r.media_id,
      destination: snapshot?.destination || 'yoru',
      identity: identity(r.media_id),
      media: metadata
        ? native(r.media_id)
          ? publicReadingMedia(metadata, { destination: snapshot.destination })
          : metadata
        : null,
    };
  };
  return {
    application: 'Yoru',
    version: 2,
    exportedAt: new Date().toISOString(),
    items: library.map((r) => ({ ...libraryAccountShape(r, null), ...shape(r, 'library') })),
    resume: resume.map((r) => ({
      ...JSON.parse(r.payload),
      ...shape(r, 'resume'),
      ...(native(r.media_id)
        ? {
            cover: `/api/media/${r.media_id}/cover?destination=${saved.get(`resume:${r.media_id}`)?.destination || 'yoru'}`,
          }
        : {}),
    })),
  };
}
