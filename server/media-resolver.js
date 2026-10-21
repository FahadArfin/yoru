import { apiError } from './validation.js';
import { parseMediaReference, parseEditionReference } from '../shared/media-reference.js';
import { readingProvider } from '../shared/catalog-preferences.js';
import { assertMediaEligible, assertSourceEligible } from '../shared/reading-eligibility.js';
export { assertMediaEligible, assertSourceEligible } from '../shared/reading-eligibility.js';
import { createExternalCatalogStore } from './external-catalog-store.js';

const unavailable = () => apiError(404, 'This title is unavailable.');
export async function resolveMedia(mediaId, context, deps) {
  const ref = parseMediaReference(mediaId);
  if (!ref) throw apiError(400, 'Invalid media ID.');
  let media =
    ref.kind === 'extension-manga'
      ? await createExternalCatalogStore(deps.db, deps).getTitle(mediaId)
      : await deps.coreMedia(mediaId);
  if (media?.id !== mediaId) throw unavailable();
  assertMediaEligible(media, context);
  if (ref.kind === 'extension-manga' && deps.bridge) {
    const store = createExternalCatalogStore(deps.db, deps);
    const expectedSource = await store.getSourceAuthority(media.sourceRef.id);
    if (!expectedSource) throw unavailable();
    assertMediaEligible({ ...media, sourceRef: expectedSource.source }, context);
    const refreshed = await deps.bridge.details(media.upstreamRef, context);
    if (
      refreshed?.upstreamRef?.sourceId !== media.upstreamRef.sourceId ||
      refreshed.upstreamRef.upstreamKey !== media.upstreamRef.upstreamKey ||
      refreshed.upstreamRef.language !== media.upstreamRef.language ||
      refreshed.sourceRef?.id !== media.sourceRef.id
    )
      throw unavailable();
    media = await store.rememberTitle(refreshed, { expectedSource, preserveSource: true });
    assertMediaEligible(media, context);
  }
  const result = ref.kind === 'extension-manga' ? publicReadingMedia(media, context) : media;
  if (deps.db && ref.kind !== 'anime') {
    const store = createExternalCatalogStore(deps.db, deps),
      candidates = [media];
    for (const mapping of await store.getEquivalences(mediaId)) {
      const id = mapping.leftId === mediaId ? mapping.rightId : mapping.leftId;
      if (parseMediaReference(id)?.kind === 'extension-manga') {
        const mapped = await store.getTitle(id);
        if (mapped?.id === id) candidates.push(mapped);
      } else if (parseMediaReference(id)?.kind === 'manga' && deps.coreMedia) {
        const mapped = await deps.coreMedia(id).catch(() => null);
        if (mapped?.id === id) candidates.push(mapped);
      }
    }
    const readingChoices = [];
    for (const candidate of candidates) {
      try {
        assertMediaEligible(candidate, context);
      } catch {
        continue;
      }
      const sources = candidate.sourceRef
        ? [candidate.sourceRef]
        : ['mangadex', 'weebcentral'].map((id) => ({
            id,
            integration: 'core',
            upstreamSourceId: null,
            providerKey: readingProvider(id),
            language: context.language || 'en',
            classification: {
              rating: 'safe',
              provenance: {
                sourceField: 'dedicated-adapter',
                value: 'non-explicit',
                checkedAt: new Date((deps.now || Date.now)()).toISOString(),
              },
            },
            capabilities: Object.fromEntries(
              ['popular', 'latest', 'search', 'details', 'chapters', 'pages', 'resolveLink'].map(
                (k) => [k, 'unverified'],
              ),
            ),
            bridgeInstance: null,
          }));
      for (const source of sources) {
        try {
          assertSourceEligible(source, context, { discovery: true });
        } catch {
          continue;
        }
        readingChoices.push({
          mediaId: candidate.id,
          sourceRef: source,
          upstreamRef: candidate.upstreamRef || null,
          integration: source.integration,
          state: candidate.upstreamRef ? 'ready' : 'unresolved',
        });
      }
    }
    return {
      ...result,
      readingChoices,
      availableIntegrations: [...new Set(readingChoices.map((c) => c.integration))],
    };
  }
  return result;
}
export function publicReadingMedia(media, context) {
  const result = {};
  for (const key of [
    'id',
    'title',
    'titleEnglish',
    'titleRomaji',
    'titleJapanese',
    'description',
    'category',
    'type',
    'format',
    'status',
    'chapters',
    'volumes',
    'score',
    'averageScore',
    'rating',
    'year',
    'startDate',
    'endDate',
    'popularity',
    'rank',
    'malId',
    'idMal',
    'sourceRef',
    'upstreamRef',
    'classification',
    'provenance',
    'availableIntegrations',
    'isAdult',
  ])
    if (Object.hasOwn(media, key)) result[key] = media[key];
  const cover = `/api/media/${media.id}/cover?destination=${context.destination}`;
  return { ...result, cover, coverImage: cover, image: cover };
}
export async function resolveReadingEdition(mediaId, editionId, context, deps) {
  const media = await resolveMedia(mediaId, context, deps),
    ref = parseEditionReference(editionId);
  if (!ref) throw apiError(400, 'Invalid chapter ID.');
  if (ref.kind === 'extension') {
    const edition = await createExternalCatalogStore(deps.db, deps).getEdition(editionId);
    if (!edition || edition.mediaId !== mediaId || media.sourceRef?.id !== edition.sourceRef.id)
      throw unavailable();
    assertSourceEligible(edition.sourceRef, context);
    return edition;
  }
  if (mediaId.startsWith('ext-')) throw unavailable();
  assertSourceEligible({ id: ref.kind, integration: 'core' }, context);
  if (!deps.coreEdition) throw unavailable();
  const edition = await deps.coreEdition(mediaId, editionId);
  if (!edition || edition.id !== editionId || (edition.mediaId && edition.mediaId !== mediaId))
    throw unavailable();
  return edition;
}
