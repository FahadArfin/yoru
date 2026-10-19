import { apiError } from './validation.js';
import { resolveReaderContext } from './reader-context.js';
import { refreshReaderSources } from './reader-source-inventory.js';
import { createContinuationStore, restartRequired } from './reader-continuation.js';
import {
  accountAtomic,
  accountRevisionStatement,
  readingEligibilityColumns,
  readingEligibilityJoins,
  readingEligibilityPredicate,
  materializeReadingEligibility,
} from './reading-account.js';
import { parseMediaReference, parseEditionReference } from '../shared/media-reference.js';
import {
  discussionReference,
  roomReferenceEligible,
  publicSocialMedia,
} from '../shared/native-social-contract.js';
import { roomReaderPath } from '../shared/room-reader.js';
import { getReadingChapter } from './reading-sources.js';
import { createHash } from 'node:crypto';
import { withinReaderDeadline } from './reader-operation.js';

const unavailable = () => apiError(404, 'This title or room is unavailable.');
const BATCH = 5000;
// Appended to room list SQL before its ORDER/LIMIT. Destination is bound by the
// caller; exact edition ownership is checked from the current canonical store.
export const roomReadingPredicate = `(em.id IS NULL OR (
 (a.unit=0 AND a.source_url='' AND a.reader_edition_id IS NULL)
 OR (a.reader_source_id=em.source_id AND a.reader_edition_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM external_editions ee WHERE ee.id=a.reader_edition_id AND ee.media_id=a.media_id))))`;
export const commentReadingPredicate = `(em.id IS NULL OR
 (a.edition_id IS NULL AND a.unit=0) OR EXISTS(
 SELECT 1 FROM external_editions ee WHERE ee.id=a.edition_id AND ee.media_id=a.media_id))`;

// One inventory per HTTP request, or one bounded inventory per <=60s live
// delivery window. An expired proof is never used while its refresh is pending.
export function liveSocialPolicy(factory, { now = Date.now } = {}) {
  let policy,
    expiresAt = 0,
    pending;
  return {
    async delivery() {
      if (!policy || now() >= expiresAt) {
        if (!pending) {
          policy = null;
          const started = now();
          pending = factory()
            .then((value) => {
              policy = value;
              expiresAt = Math.min(started + 60000, (value.startedAt ?? started) + 60000);
              return value;
            })
            .finally(() => {
              pending = null;
            });
        }
        await pending;
      }
      await policy.current();
      return policy;
    },
  };
}

// Both HTTP runtimes call this boundary before their existing ownership,
// visibility, capacity and host checks. Cleanup/leave deliberately bypass it.
export async function authorizeSocialRequest(policy, method, path, query = {}, body = {}) {
  const db = policy.deps.db;
  const route = path.replace(/^\/api/, '').replace(/\/$/, '');
  let match;
  if ((match = /^\/reviews\/([^/]+)$/.exec(route))) {
    if (method === 'DELETE') {
      const row = await db.get('SELECT * FROM reviews WHERE id=?', match[1]);
      if (!row) throw unavailable();
      return { media: await policy.media(row.media_id) };
    }
    return { media: await policy.media(match[1]) };
  }
  if ((match = /^\/comments\/([^/]+)(\/vote)?$/.exec(route))) {
    if (method === 'DELETE' || match[2]) {
      const row = await db.get('SELECT * FROM comments WHERE id=?', match[1]);
      if (!row) throw unavailable();
      return { discussion: await policy.discussion(row.media_id, row.unit, row.edition_id) };
    }
    return {
      discussion: await policy.discussion(
        match[1],
        body.unit ?? query.unit ?? 0,
        body.edition ?? query.edition ?? null,
      ),
    };
  }
  if ((match = /^\/rooms\/([^/]+)(?:\/(join|chat))?$/.exec(route))) {
    const room = await db.get('SELECT * FROM rooms WHERE id=? AND closed_at IS NULL', match[1]);
    return { room, media: await policy.room(room, { direct: true }) };
  }
  if (route === '/rooms' && method === 'POST') return { media: await policy.media(body.mediaId) };
  if (['/events', '/poll'].includes(route) && query.roomId) {
    const room = await db.get('SELECT * FROM rooms WHERE id=? AND closed_at IS NULL', query.roomId);
    return { room, media: await policy.room(room, { direct: true }) };
  }
  return {};
}

/** One request-local inventory and the shared account policy projection. Callers
 * supply fixed SQL, never user SQL. Native metadata is public/destination-shaped
 * only after current canonical source identity and classification are verified.
 */
export async function createSocialPolicy(context, deps, params = {}) {
  const clock = deps.now || Date.now,
    startedAt = clock(),
    deadlineAt = startedAt + 12000;
  const continuations = createContinuationStore(deps.db, deps);
  const proofs = new Map();
  const editionProofs = new Map();
  let inventory = { currentSources: [], complete: true, sourceStates: [], nextCursor: null };
  let sourceCursor = null;
  if (params.sourceCursor) {
    const saved = await continuations.resume(params.sourceCursor, context);
    if (saved.kind !== 'social-inventory') throw restartRequired();
    sourceCursor = saved.upstream;
  }
  if (context.extensionsEnabled) {
    try {
      inventory = await (deps.refreshSources || refreshReaderSources)(context, deps, {
        deadlineAt,
        cursor: sourceCursor,
        maxOperations: 4,
        limit: 100,
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
  async function current() {
    if (context.signal?.aborted) throw apiError(408, 'Social request cancelled.');
    if (context.sessionHash || context.guestId) {
      const latest = await resolveReaderContext(
        { destination: context.destination, language: context.language },
        { ...context, db: deps.db },
      );
      if (
        latest.revision !== context.revision ||
        latest.selectionFingerprint !== context.selectionFingerprint
      )
        throw restartRequired();
    }
    return context;
  }
  function guardStatements({ identity = false } = {}) {
    const checks = [];
    if (identity && context.userId) {
      checks.push(accountRevisionStatement(context));
      if (context.sessionHash)
        checks.push({
          sql: "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?) THEN 'true' ELSE 'social_session_revoked' END)",
          values: [context.sessionHash, context.userId, clock()],
        });
    }
    if (proofs.size) {
      const proof = JSON.stringify([...proofs.values()]);
      checks.push({
        sql: `SELECT json(CASE WHEN COUNT(*)=json_array_length(?) THEN 'true' ELSE 'social_policy_changed' END) FROM json_each(?) policy LEFT JOIN external_media em ON em.id=json_extract(policy.value,'$.id') LEFT JOIN reader_sources rs ON rs.id=em.source_id WHERE (json_extract(policy.value,'$.native')=0 OR em.id IS NOT NULL) AND ${readingEligibilityPredicate}`,
        values: [proof, proof],
      });
    }
    if (editionProofs.size) {
      const proof = JSON.stringify([...editionProofs.values()]);
      checks.push({
        sql: `SELECT json(CASE WHEN COUNT(*)=json_array_length(?) THEN 'true' ELSE 'social_edition_changed' END) FROM json_each(?) proof JOIN external_editions ee ON ee.id=json_extract(proof.value,'$.id') JOIN external_media em ON em.id=ee.media_id WHERE ee.media_id=json_extract(proof.value,'$.mediaId') AND em.source_id=json_extract(proof.value,'$.sourceId')`,
        values: [proof, proof],
      });
    }
    if (!context.userId && context.guestId)
      checks.push({
        sql: "SELECT json(CASE WHEN COALESCE((SELECT revision FROM reader_guest_contexts WHERE guest_hash=? AND destination=? AND expires_at>?),0)=? THEN 'true' ELSE 'reader_preferences_changed' END)",
        values: [
          createHash('sha256').update(context.guestId).digest('hex'),
          context.destination,
          clock(),
          context.revision,
        ],
      });
    return checks;
  }
  async function atomic(statements) {
    await current();
    const checks = guardStatements();
    if (!context.userId && !checks.length && !statements.length) return [];
    try {
      const rows = context.userId
        ? await accountAtomic(context, [...checks, ...statements], deps)
        : await deps.db.atomic([...checks, ...statements]);
      return rows.slice(checks.length);
    } catch (error) {
      if (/social_policy_changed|malformed JSON/.test(error.message)) throw unavailable();
      throw error;
    }
  }
  async function project(rows, { direct = false } = {}) {
    if (context.extensionsEnabled && clock() - startedAt >= 60000)
      throw apiError(503, 'Source inventory expired. Try again.');
    const coreMedia = [
      ...(await deps.coreAccountMedia(
        rows
          .filter((r) => parseMediaReference(r.media_id)?.kind !== 'extension-manga')
          .map((r) => r.media_id),
      )),
    ];
    if (
      direct &&
      deps.coreMedia &&
      rows.length === 1 &&
      parseMediaReference(rows[0].media_id)?.kind !== 'extension-manga' &&
      !coreMedia.some((item) => item.id === rows[0].media_id)
    ) {
      const id = rows[0].media_id;
      const resolved = await withinReaderDeadline(
        { signal: context.signal, deadlineAt, priority: 'interactive' },
        (operation) => deps.coreMedia(id, operation),
        clock,
      );
      const category = String(resolved?.category || resolved?.type || '').toUpperCase();
      if (
        resolved?.id === id &&
        typeof resolved.title === 'string' &&
        resolved.title &&
        (parseMediaReference(id)?.kind === 'anime'
          ? category === 'ANIME'
          : ['MANGA', 'MANHWA'].includes(category))
      )
        coreMedia.push(resolved);
    }
    await current();
    const result = materializeReadingEligibility(rows, context, {
      currentSources: inventory.currentSources,
      coreMedia,
      sourceCheckSince: startedAt,
    });
    for (const [id, item] of result.mediaById) result.mediaById.set(id, publicSocialMedia(item));
    result.eligible = result.eligible.map((item) => ({
      ...item,
      native: Number(parseMediaReference(item.id)?.kind === 'extension-manga'),
      category: result.mediaById.get(item.id).category,
    }));
    return result;
  }
  let sourceToken;
  async function status() {
    if (sourceToken === undefined)
      sourceToken = inventory.nextCursor
        ? await continuations.start(context, {
            kind: 'social-inventory',
            upstream: inventory.nextCursor,
          })
        : null;
    return {
      complete: inventory.complete === true,
      sourceStates: inventory.sourceStates || [],
      nextSourceCursor: sourceToken,
      selectionFingerprint: context.selectionFingerprint,
    };
  }
  async function media(id, { direct = true } = {}) {
    if (!parseMediaReference(id)) throw apiError(400, 'Invalid media ID.');
    const rows = await deps.db.all(
      `SELECT ${readingEligibilityColumns} FROM (SELECT ? AS media_id) a ${readingEligibilityJoins}`,
      id,
    );
    const projected = await project(rows, { direct });
    const [accepted] = await atomic([
      {
        sql: `SELECT a.media_id FROM (SELECT ? AS media_id) a ${readingEligibilityJoins} JOIN json_each(?) policy ON json_extract(policy.value,'$.id')=a.media_id WHERE ${readingEligibilityPredicate}`,
        values: [id, JSON.stringify(projected.eligible)],
      },
    ]);
    if (!accepted.length) throw unavailable();
    proofs.set(id, projected.eligible[0]);
    return projected.mediaById.get(id);
  }
  async function mediaBatch(ids) {
    const unique = [...new Set(ids)].filter((id) => parseMediaReference(id));
    if (unique.length > BATCH) throw apiError(400, 'Too many social titles.');
    const input = JSON.stringify(unique);
    const rows = await deps.db.all(
      `SELECT ${readingEligibilityColumns} FROM (SELECT value AS media_id FROM json_each(?)) a ${readingEligibilityJoins}`,
      input,
    );
    const projected = await project(rows);
    const [accepted] = await atomic([
      {
        sql: `SELECT a.media_id FROM (SELECT value AS media_id FROM json_each(?)) a ${readingEligibilityJoins} JOIN json_each(?) policy ON json_extract(policy.value,'$.id')=a.media_id WHERE ${readingEligibilityPredicate}`,
        values: [input, JSON.stringify(projected.eligible)],
      },
    ]);
    return new Map(accepted.map((row) => [row.media_id, projected.mediaById.get(row.media_id)]));
  }
  async function room(row, { direct = false } = {}) {
    if (!row || (row.destination || 'yoru') !== context.destination) throw unavailable();
    const item = await media(row.media_id, { direct });
    if (!roomReferenceEligible(row, item, context.destination)) throw unavailable();
    if (item.sourceRef && !row.reader_edition_id && (Number(row.unit || 0) !== 0 || row.source_url))
      throw unavailable();
    if (row.reader_source_id && row.reader_source_id !== item.sourceRef?.id) throw unavailable();
    if (row.reader_edition_id) {
      const edition = await deps.db.get(
        'SELECT ee.media_id,em.source_id FROM external_editions ee JOIN external_media em ON em.id=ee.media_id WHERE ee.id=?',
        row.reader_edition_id,
      );
      if (!edition || edition.media_id !== row.media_id || edition.source_id !== item.sourceRef?.id)
        throw unavailable();
      const path = roomReaderPath(row.source_url, row.media_id, row.unit, {
        destination: context.destination,
      });
      if (!path) throw unavailable();
      const url = new URL(path, 'https://yoru.invalid');
      if (
        url.searchParams.get('chapter') !== row.reader_edition_id ||
        url.searchParams.get('source') !== row.reader_source_id
      )
        throw unavailable();
      editionProofs.set(row.reader_edition_id, {
        id: row.reader_edition_id,
        mediaId: row.media_id,
        sourceId: edition.source_id,
      });
    }
    return item;
  }
  async function edition(mediaId, editionId, { unit, sourceId } = {}) {
    const item = await media(mediaId);
    // The canonical resolver may legitimately refresh this title. Its source
    // CAS protects that write; acquire a new proof after it returns, rather
    // than comparing its new timestamp against our own pre-refresh token.
    proofs.delete(mediaId);
    const chapter = await withinReaderDeadline(
      { signal: context.signal, deadlineAt, priority: 'interactive' },
      (operation) =>
        getReadingChapter(mediaId, editionId, {
          ...deps,
          media: deps.coreMedia,
          readerDb: deps.db,
          context: { ...context, ...operation },
          userId: context.userId,
          sessionHash: context.sessionHash,
        }),
      clock,
    );
    if (
      sourceId &&
      (item.sourceRef
        ? chapter.sourceRef?.id !== sourceId
        : parseEditionReference(editionId)?.kind !== sourceId)
    )
      throw unavailable();
    if (
      !item.sourceRef &&
      unit !== undefined &&
      Number(chapter.number ?? chapter.chapter ?? 0) !== unit
    )
      throw unavailable();
    if (item.sourceRef) {
      const observed = inventory.currentSources.find((s) => s.id === item.sourceRef.id);
      if (chapter.sourceRef?.classification?.rating !== observed?.classification?.rating)
        throw unavailable();
    }
    await media(mediaId);
    await pinEdition(mediaId, editionId);
    return chapter;
  }
  async function pinEdition(mediaId, editionId) {
    if (parseEditionReference(editionId)?.kind !== 'extension') return;
    const row = await deps.db.get(
      'SELECT ee.media_id,em.source_id FROM external_editions ee JOIN external_media em ON em.id=ee.media_id WHERE ee.id=?',
      editionId,
    );
    const item = await media(mediaId);
    if (!row || row.media_id !== mediaId || row.source_id !== item.sourceRef?.id)
      throw unavailable();
    editionProofs.set(editionId, { id: editionId, mediaId, sourceId: row.source_id });
  }
  async function discussion(mediaId, unit = 0, editionId = null) {
    const ref = discussionReference(mediaId, unit, editionId);
    if (!ref) throw apiError(400, 'Choose an exact chapter or a whole-title discussion.');
    const item = await media(mediaId);
    if (ref.editionId) await edition(mediaId, ref.editionId);
    return { ...ref, media: item };
  }
  async function reader(value, mediaId, unit) {
    const path = roomReaderPath(value, mediaId, unit, { destination: context.destination });
    if (!path) throw apiError(400, 'Choose a reader link for this title and chapter.');
    const url = new URL(path, 'https://yoru.invalid'),
      item = await media(mediaId);
    const editionId = url.searchParams.get('chapter'),
      sourceId = url.searchParams.get('source');
    if (item.sourceRef && (!editionId || sourceId !== item.sourceRef.id)) throw unavailable();
    if (editionId && sourceId !== 'local') await edition(mediaId, editionId, { unit, sourceId });
    return {
      path,
      sourceId: item.sourceRef?.id || null,
      editionId: item.sourceRef ? editionId : null,
      provenance: item.provenance || null,
    };
  }
  async function select({
    candidates,
    candidateValues = [],
    where = '1',
    values = [],
    orderBy = [
      ['social_sort', 'DESC'],
      ['social_id', 'DESC'],
    ],
    limit,
    scope = [],
    rowAllowed = () => true,
  }) {
    if (!Number.isInteger(limit) || limit < 1 || limit > BATCH)
      throw apiError(400, 'Invalid social page size.');
    if (
      !orderBy.length ||
      orderBy.some(
        ([column, direction]) => !/^[a-z_]+$/.test(column) || !['ASC', 'DESC'].includes(direction),
      )
    )
      throw apiError(500, 'Invalid social ordering.');
    // Scope binds semantic request filters; wall-clock liveness parameters may
    // advance between pages and must still be checked against the current time.
    const key = createHash('sha256')
      .update(JSON.stringify({ candidates, where, scope, orderBy, limit }))
      .digest('hex');
    const order = orderBy.map(([column, direction]) => `a.${column} ${direction}`).join(',');
    const rowCursor = (row) => orderBy.map(([column]) => row[column]);
    const boundary = (cursor) => {
      if (!cursor) return { sql: '1', values: [] };
      if (
        !Array.isArray(cursor) ||
        cursor.length !== orderBy.length ||
        cursor.some((value) => !['string', 'number'].includes(typeof value))
      )
        throw restartRequired();
      const clauses = [],
        bindings = [];
      for (let i = 0; i < orderBy.length; i++) {
        clauses.push(
          `(${orderBy
            .slice(0, i)
            .map(([column]) => `a.${column}=? AND `)
            .join('')}a.${orderBy[i][0]}${orderBy[i][1] === 'DESC' ? '<' : '>'}?)`,
        );
        bindings.push(...cursor.slice(0, i + 1));
      }
      return { sql: clauses.join(' OR '), values: bindings };
    };
    let after = null,
      exhausted = false,
      lastScanned = null;
    if (params.cursor) {
      const saved = await continuations.resume(params.cursor, context);
      if (saved.kind !== 'social-scan' || saved.key !== key) throw restartRequired();
      after = saved.after;
    }
    const selected = [],
      eligible = new Map(),
      mediaById = new Map();
    for (let batch = 0; batch < 20; batch++) {
      await current();
      if (clock() >= deadlineAt) break;
      const bound = boundary(after);
      const rows = await deps.db.all(
        `SELECT ${readingEligibilityColumns} FROM (${candidates}) a ${readingEligibilityJoins} WHERE (${bound.sql}) ORDER BY ${order} LIMIT ?`,
        ...candidateValues,
        ...bound.values,
        BATCH,
      );
      if (!rows.length) {
        exhausted = true;
        break;
      }
      const result = await project(rows);
      const proofById = new Map(result.eligible.map((proof) => [proof.id, proof]));
      const [accepted] = await atomic([
        {
          sql: `SELECT a.* FROM (${candidates}) a ${readingEligibilityJoins}
 JOIN json_each(?) policy ON json_extract(policy.value,'$.id')=a.media_id
 JOIN json_each(?) scanned ON scanned.value=a.social_id
 WHERE (${where}) AND ${readingEligibilityPredicate} ORDER BY ${order} LIMIT ?`,
          values: [
            ...candidateValues,
            JSON.stringify(result.eligible),
            JSON.stringify(
              rows
                .filter((row) =>
                  rowAllowed(row, result.mediaById.get(row.media_id), context.destination),
                )
                .map((row) => row.social_id),
            ),
            ...values,
            limit + 1 - selected.length,
          ],
        },
      ]);
      for (const row of accepted) {
        selected.push(row);
        eligible.set(row.media_id, proofById.get(row.media_id));
        mediaById.set(row.media_id, result.mediaById.get(row.media_id));
      }
      lastScanned = rows.at(-1);
      after = rowCursor(lastScanned);
      exhausted = rows.length < BATCH;
      if (selected.length > limit || exhausted) break;
    }
    const [verified] = await atomic([
      {
        sql: `SELECT a.* FROM (${candidates}) a ${readingEligibilityJoins}
 JOIN json_each(?) policy ON json_extract(policy.value,'$.id')=a.media_id
 JOIN json_each(?) chosen ON chosen.value=a.social_id
 WHERE (${where}) AND ${readingEligibilityPredicate} ORDER BY ${order} LIMIT ?`,
        values: [
          ...candidateValues,
          JSON.stringify([...eligible.values()]),
          JSON.stringify(selected.map((row) => row.social_id)),
          ...values,
          limit + 1,
        ],
      },
    ]);
    if (
      verified.length !== selected.length ||
      verified.some((row) => !rowAllowed(row, mediaById.get(row.media_id), context.destination))
    )
      throw restartRequired();
    const rows = verified.slice(0, limit),
      moreRows = verified.length > limit || !exhausted;
    const nextAfter = verified.length > limit ? rowCursor(rows.at(-1)) : after;
    return {
      rows,
      mediaById,
      ...(await status()),
      hasMore: moreRows || !inventory.complete,
      complete: !moreRows && inventory.complete === true,
      nextCursor:
        moreRows && nextAfter
          ? await continuations.start(context, { kind: 'social-scan', key, after: nextAfter })
          : null,
    };
  }
  await current();
  return {
    context,
    startedAt,
    deadlineAt,
    deps,
    current,
    atomic,
    guardStatements,
    project,
    select,
    media,
    mediaBatch,
    room,
    edition,
    pinEdition,
    discussion,
    reader,
    status,
  };
}
