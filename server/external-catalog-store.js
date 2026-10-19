import { apiError } from './validation.js';
import { parseMediaReference } from '../shared/media-reference.js';
import { decimalSourceId } from '../services/reader-bridge/suwayomi-operations.mjs';

// Permanent identity records are deliberately separate from catalog/image caches.
export const externalCatalogSchema = `
CREATE TABLE IF NOT EXISTS reader_sources (
  id TEXT PRIMARY KEY NOT NULL, integration TEXT NOT NULL, upstream_source_id TEXT,
  provider_key TEXT NOT NULL, language TEXT NOT NULL, classification TEXT NOT NULL,
  capabilities TEXT NOT NULL, bridge_instance TEXT, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS reader_sources_upstream ON reader_sources(integration,upstream_source_id);
CREATE TABLE IF NOT EXISTS external_media (
  id TEXT PRIMARY KEY NOT NULL, source_id TEXT NOT NULL REFERENCES reader_sources(id),
  upstream_key TEXT NOT NULL, language TEXT NOT NULL, classification TEXT NOT NULL,
  metadata TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS external_media_canonical ON external_media(source_id,upstream_key,language);
CREATE TABLE IF NOT EXISTS external_editions (
  id TEXT PRIMARY KEY NOT NULL, media_id TEXT NOT NULL REFERENCES external_media(id),
  upstream_key TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS external_editions_canonical ON external_editions(media_id,upstream_key);
CREATE TABLE IF NOT EXISTS reader_local_bindings (
  reference_id TEXT PRIMARY KEY NOT NULL, source_id TEXT NOT NULL REFERENCES reader_sources(id),
  media_id TEXT REFERENCES external_media(id), edition_id TEXT REFERENCES external_editions(id),
  kind TEXT NOT NULL, bridge_instance TEXT NOT NULL, local_id TEXT NOT NULL, verified_at TEXT NOT NULL,
  CONSTRAINT reader_binding_owner CHECK (
    (kind='media' AND media_id IS NOT NULL AND media_id=reference_id AND edition_id IS NULL) OR
    (kind='edition' AND edition_id IS NOT NULL AND edition_id=reference_id AND media_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS reader_bindings_local ON reader_local_bindings(bridge_instance,kind,local_id);
CREATE TABLE IF NOT EXISTS reader_equivalences (
  left_id TEXT NOT NULL, right_id TEXT NOT NULL, evidence TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(left_id,right_id), CONSTRAINT reader_equivalence_order CHECK(left_id<right_id)
);
`;

const conflict = () => apiError(409, 'Conflicting canonical identity or ownership.');
const invalid = (name) => apiError(400, `Invalid ${name}.`);
function exactText(value, name, max = 2048) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw invalid(name);
  }
  return value;
}
function json(value, name, limit = 131072) {
  function finite(item, depth = 0) {
    if (depth > 16) throw invalid(name);
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (
      typeof item !== 'object' ||
      !item ||
      (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)
    ) {
      throw invalid(name);
    }
    for (const nested of Object.values(item)) finite(nested, depth + 1);
  }
  finite(value);
  const result = JSON.stringify(value);
  if (result.length > limit) throw invalid(name);
  return result;
}
function object(value, name) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw invalid(name);
  return value;
}
function classification(value) {
  object(value, 'classification');
  if (!['safe', 'adult', 'mixed', 'unknown'].includes(value.rating))
    throw invalid('classification');
  const provenance = object(value.provenance, 'classification provenance');
  if (provenance.sourceField !== null)
    exactText(provenance.sourceField, 'classification field', 256);
  exactText(provenance.checkedAt, 'classification timestamp', 64);
  if (!Number.isFinite(Date.parse(provenance.checkedAt))) throw invalid('classification timestamp');
  json(value, 'classification', 16384);
  return value;
}
export function validateReaderSource(value) {
  object(value, 'source');
  exactText(value.id, 'source ID', 128);
  if (value.integration === 'suwayomi') {
    if (
      !value.id.startsWith('suwayomi:') ||
      !decimalSourceId(value.id.slice(9)) ||
      value.upstreamSourceId !== value.id.slice(9)
    )
      throw invalid('source ID');
  } else if (value.integration !== 'core' || !['mangadex', 'weebcentral'].includes(value.id))
    throw invalid('source integration');
  if (value.upstreamSourceId !== null) exactText(value.upstreamSourceId, 'upstream source ID', 128);
  exactText(value.providerKey, 'provider key', 256);
  exactText(value.language, 'source language', 64);
  classification(value.classification);
  const capabilities = object(value.capabilities, 'source capabilities');
  for (const key of [
    'popular',
    'latest',
    'search',
    'details',
    'chapters',
    'pages',
    'resolveLink',
  ]) {
    if (!['supported', 'unsupported', 'unverified'].includes(capabilities[key]))
      throw invalid('source capabilities');
  }
  if (value.bridgeInstance !== null) exactText(value.bridgeInstance, 'bridge instance', 256);
  return value;
}
const sourceRef = validateReaderSource;
function titleRef(value, source) {
  object(value, 'canonical title reference');
  if (value.sourceId !== source.id) throw conflict();
  exactText(value.upstreamKey, 'canonical title key');
  exactText(value.language, 'title language', 64);
  return value;
}
function publicMetadata(value) {
  const metadata = { ...JSON.parse(value) };
  for (const key of [
    'id',
    'mediaId',
    'sourceRef',
    'upstreamRef',
    'classification',
    'provenance',
    'availableIntegrations',
    'integration',
    'localMangaId',
    'localChapterId',
    'localId',
    'bridgeInstance',
  ])
    delete metadata[key];
  return metadata;
}
const assertion = (sql, values) => ({
  sql: `SELECT json(CASE WHEN (${sql}) THEN 'true' ELSE 'reader_identity_conflict' END)`,
  values,
});

/** @param {import('../shared/reading-contracts.js').ReaderDb} db */
export function createExternalCatalogStore(
  db,
  { now = Date.now, uuid = () => crypto.randomUUID(), coreAccountMedia } = {},
) {
  const timestamp = () => new Date(now()).toISOString();
  const mint = (prefix) => {
    const id = uuid().replaceAll('-', '');
    if (!/^[0-9a-f]{32}$/.test(id)) throw invalid('identity generator');
    return prefix + id;
  };
  const atomic = async (statements) => {
    try {
      return await db.atomic(statements);
    } catch (error) {
      if (
        /reader_identity_conflict|malformed JSON|UNIQUE constraint|CHECK constraint/i.test(
          error.message,
        )
      )
        throw conflict();
      throw error;
    }
  };
  function sourceStatements(input) {
    const s = sourceRef(input),
      at = timestamp();
    return [
      {
        sql: `INSERT INTO reader_sources(id,integration,upstream_source_id,provider_key,language,classification,capabilities,bridge_instance,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET classification=excluded.classification,
          capabilities=excluded.capabilities,bridge_instance=excluded.bridge_instance,
          updated_at=CASE WHEN excluded.updated_at<=reader_sources.updated_at
          THEN strftime('%Y-%m-%dT%H:%M:%fZ',reader_sources.updated_at,'+0.001 seconds')
          ELSE excluded.updated_at END
          WHERE integration=excluded.integration AND upstream_source_id IS excluded.upstream_source_id
          AND provider_key=excluded.provider_key AND language=excluded.language`,
        values: [
          s.id,
          s.integration,
          s.upstreamSourceId,
          s.providerKey,
          s.language,
          json(s.classification, 'classification', 16384),
          json(s.capabilities, 'capabilities', 16384),
          s.bridgeInstance,
          at,
        ],
      },
      assertion(
        'EXISTS(SELECT 1 FROM reader_sources WHERE id=? AND integration=? AND upstream_source_id IS ? AND provider_key=? AND language=?)',
        [s.id, s.integration, s.upstreamSourceId, s.providerKey, s.language],
      ),
    ];
  }
  function sourceFromRow(row) {
    return (
      row && {
        id: row.id,
        integration: row.integration,
        upstreamSourceId: row.upstream_source_id,
        providerKey: row.provider_key,
        language: row.language,
        classification: JSON.parse(row.classification),
        capabilities: JSON.parse(row.capabilities),
        bridgeInstance: row.bridge_instance,
      }
    );
  }
  function authorityFromRow(row) {
    return row ? { id: row.id, version: row.updated_at, source: sourceFromRow(row) } : null;
  }
  async function getSourceAuthority(id) {
    return authorityFromRow(await db.get('SELECT * FROM reader_sources WHERE id=?', id));
  }
  async function readSource(id) {
    return sourceFromRow(await db.get('SELECT * FROM reader_sources WHERE id=?', id));
  }
  async function getTitle(id) {
    const row = await db.get('SELECT * FROM external_media WHERE id=?', id);
    if (!row) return null;
    const metadata = publicMetadata(row.metadata),
      source = await readSource(row.source_id);
    const upstreamRef = {
      sourceId: row.source_id,
      upstreamKey: row.upstream_key,
      language: row.language,
    };
    const rating = JSON.parse(row.classification);
    return {
      score: null,
      averageScore: null,
      rating: null,
      year: null,
      startDate: null,
      endDate: null,
      popularity: null,
      rank: null,
      ...metadata,
      id: row.id,
      category: metadata.category === 'MANHWA' ? 'MANHWA' : 'MANGA',
      type: metadata.category === 'MANHWA' ? 'MANHWA' : 'MANGA',
      malId: null,
      idMal: null,
      sourceRef: source,
      upstreamRef,
      classification: rating,
      provenance: rating.provenance,
      availableIntegrations: [source.integration],
    };
  }
  async function getEdition(id) {
    const row = await db.get('SELECT * FROM external_editions WHERE id=?', id);
    if (!row) return null;
    const media = await getTitle(row.media_id),
      metadata = publicMetadata(row.metadata);
    const pageCount = metadata.pageCount ?? metadata.pages ?? null;
    return {
      ...metadata,
      id: row.id,
      mediaId: row.media_id,
      sourceRef: media.sourceRef,
      upstreamRef: { title: media.upstreamRef, upstreamKey: row.upstream_key },
      integration: media.sourceRef.integration,
      volume: metadata.volume ?? null,
      number: metadata.number ?? null,
      language: metadata.language ?? media.upstreamRef.language,
      order: metadata.order ?? 0,
      pageCount,
      pages: pageCount,
    };
  }
  async function reference(id) {
    if (id?.startsWith('ext-manga-')) {
      const media = await getTitle(id);
      return media && { kind: 'media', sourceId: media.sourceRef.id, canonical: media.upstreamRef };
    }
    if (id?.startsWith('ext-chapter-')) {
      const edition = await getEdition(id);
      return (
        edition && {
          kind: 'edition',
          sourceId: edition.sourceRef.id,
          canonical: edition.upstreamRef,
        }
      );
    }
    if (parseMediaReference(id)?.kind === 'manga') {
      if (coreAccountMedia) {
        const known = await coreAccountMedia([id]);
        if (
          known.some(
            (media) =>
              media?.id === id &&
              typeof media.title === 'string' &&
              media.title &&
              ['MANGA', 'MANHWA'].includes(media.category),
          )
        )
          return { kind: 'media', sourceId: null, canonical: null };
      }
      // Sites owns SQL catalog/import metadata; Node owns its verified cache.
      // Absence of either optional SQL cache is unknown, never prefix-only proof.
      for (const [table, column] of [
        ['catalog_media', 'id'],
        ['imported_media', 'media_id'],
      ]) {
        try {
          if (await db.get(`SELECT 1 FROM ${table} WHERE ${column}=?`, id))
            return { kind: 'media', sourceId: null, canonical: null };
        } catch (error) {
          if (!/no such table: (?:catalog_media|imported_media)\b/i.test(error.message))
            throw error;
        }
      }
    }
    return null;
  }
  return {
    async rememberSource(input) {
      await atomic(sourceStatements(input));
      return readSource(input.id);
    },
    getSourceAuthority,
    async rememberTitle(input, options = {}) {
      object(input, 'title');
      const s = sourceRef(input.sourceRef),
        ref = titleRef(input.upstreamRef, s);
      classification(input.classification);
      const metadata = json(object(input.metadata, 'title metadata'), 'title metadata');
      const at = timestamp();
      const guarded = Object.hasOwn(options, 'expectedSource');
      const expected = options.expectedSource;
      if (
        guarded &&
        expected !== null &&
        (expected?.id !== s.id || typeof expected.version !== 'string')
      )
        throw invalid('source authority');
      const committed = await atomic([
        // Omitted means unguarded initialization; explicit null guards absence.
        // Compare before ANY source/title persistence in this transaction.
        ...(guarded
          ? [
              expected === null
                ? assertion('NOT EXISTS(SELECT 1 FROM reader_sources WHERE id=?)', [s.id])
                : assertion('EXISTS(SELECT 1 FROM reader_sources WHERE id=? AND updated_at=?)', [
                    s.id,
                    expected.version,
                  ]),
            ]
          : []),
        ...sourceStatements(s),
        {
          sql: `INSERT INTO external_media(id,source_id,upstream_key,language,classification,metadata,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_id,upstream_key,language) DO UPDATE SET
          classification=excluded.classification,metadata=excluded.metadata,updated_at=excluded.updated_at`,
          values: [
            mint('ext-manga-'),
            s.id,
            ref.upstreamKey,
            ref.language,
            json(input.classification, 'classification', 16384),
            metadata,
            at,
            at,
          ],
        },
        { sql: 'SELECT * FROM reader_sources WHERE id=?', values: [s.id] },
      ]);
      const row = await db.get(
        'SELECT id FROM external_media WHERE source_id=? AND upstream_key=? AND language=?',
        s.id,
        ref.upstreamKey,
        ref.language,
      );
      const result = await getTitle(row.id);
      // Non-public token comes from THIS committed transaction, never a later read.
      Object.defineProperty(result, 'sourceAuthority', {
        value: authorityFromRow(committed.at(-1)[0]),
      });
      return result;
    },
    getTitle,
    async rememberEdition(mediaId, input, { expectedSource = input?.sourceRef } = {}) {
      object(input, 'edition');
      const s = sourceRef(input.sourceRef),
        upstream = object(input.upstreamRef, 'canonical edition reference');
      const ref = titleRef(upstream.title, s);
      const expected = sourceRef(expectedSource);
      const sourcePolicy = (value) => [
        value.id,
        value.integration,
        value.upstreamSourceId,
        value.providerKey,
        value.language,
        value.classification.rating,
        json(value.capabilities, 'source capabilities', 16384),
        value.bridgeInstance,
      ];
      if (JSON.stringify(sourcePolicy(s)) !== JSON.stringify(sourcePolicy(expected)))
        throw conflict();
      exactText(upstream.upstreamKey, 'canonical edition key');
      const media = await getTitle(mediaId);
      if (
        !media ||
        media.sourceRef.id !== s.id ||
        media.upstreamRef.upstreamKey !== ref.upstreamKey ||
        media.upstreamRef.language !== ref.language
      )
        throw conflict();
      const at = timestamp();
      await atomic([
        // Editions are not fresh source observations. Compare request-start policy
        // before writing, without rewriting authority or conflicting with another
        // healthy observation that only advances its provenance timestamp.
        assertion(
          `EXISTS(SELECT 1 FROM reader_sources WHERE id=? AND integration=? AND upstream_source_id IS ?
          AND provider_key=? AND language=? AND json_extract(classification,'$.rating')=?
          AND capabilities=? AND bridge_instance IS ?)`,
          sourcePolicy(expected),
        ),
        assertion(
          'EXISTS(SELECT 1 FROM external_media WHERE id=? AND source_id=? AND upstream_key=? AND language=?)',
          [mediaId, s.id, ref.upstreamKey, ref.language],
        ),
        {
          sql: `INSERT INTO external_editions(id,media_id,upstream_key,metadata,created_at,updated_at)
            VALUES(?,?,?,?,?,?) ON CONFLICT(media_id,upstream_key) DO UPDATE SET metadata=excluded.metadata,updated_at=excluded.updated_at`,
          values: [
            mint('ext-chapter-'),
            mediaId,
            upstream.upstreamKey,
            json(object(input.metadata, 'edition metadata'), 'edition metadata'),
            at,
            at,
          ],
        },
      ]);
      const row = await db.get(
        'SELECT id FROM external_editions WHERE media_id=? AND upstream_key=?',
        mediaId,
        upstream.upstreamKey,
      );
      return getEdition(row.id);
    },
    getEdition,
    async bindLocal(referenceId, input) {
      object(input, 'verified local binding');
      const owner = await reference(referenceId);
      if (!owner?.sourceId) throw conflict();
      const bridgeInstance = exactText(input.bridgeInstance, 'bridge instance', 256);
      if (typeof input.localId !== 'string' || !/^[1-9]\d{0,24}$/.test(input.localId))
        throw invalid('local ID');
      const verifiedAt = exactText(input.verifiedAt, 'verified timestamp', 64);
      if (!Number.isFinite(Date.parse(verifiedAt))) throw invalid('verified timestamp');
      await atomic([
        {
          sql: `INSERT INTO reader_local_bindings(reference_id,source_id,media_id,edition_id,kind,bridge_instance,local_id,verified_at)
          VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(reference_id) DO UPDATE SET bridge_instance=excluded.bridge_instance,
          local_id=excluded.local_id,verified_at=excluded.verified_at`,
          values: [
            referenceId,
            owner.sourceId,
            owner.kind === 'media' ? referenceId : null,
            owner.kind === 'edition' ? referenceId : null,
            owner.kind,
            bridgeInstance,
            input.localId,
            verifiedAt,
          ],
        },
      ]);
      return { referenceId, bridgeInstance, localId: input.localId, verifiedAt };
    },
    async addEquivalence(leftId, rightId, evidence) {
      object(evidence, 'equivalence evidence');
      if (!['canonical-identity', 'trusted-mapping'].includes(evidence.kind))
        throw invalid('equivalence evidence');
      exactText(evidence.reference, 'equivalence evidence reference');
      const encoded = json(evidence, 'equivalence evidence', 8192);
      const left = await reference(leftId),
        right = await reference(rightId);
      if (!left || !right || leftId === rightId || left.kind !== right.kind) throw conflict();
      if (
        evidence.kind === 'canonical-identity' &&
        (!left.canonical ||
          !right.canonical ||
          json(left.canonical, 'canonical reference') !==
            json(right.canonical, 'canonical reference'))
      )
        throw conflict();
      const [a, b] = [leftId, rightId].sort();
      await atomic([
        {
          sql: `INSERT INTO reader_equivalences(left_id,right_id,evidence,created_at) VALUES(?,?,?,?)
        ON CONFLICT(left_id,right_id) DO UPDATE SET evidence=excluded.evidence`,
          values: [a, b, encoded, timestamp()],
        },
      ]);
    },
    async getEquivalences(id) {
      const rows = await db.all(
        'SELECT * FROM reader_equivalences WHERE left_id=? OR right_id=? ORDER BY left_id,right_id',
        id,
        id,
      );
      return rows.map((row) => ({
        leftId: row.left_id,
        rightId: row.right_id,
        evidence: JSON.parse(row.evidence),
        createdAt: row.created_at,
      }));
    },
  };
}
