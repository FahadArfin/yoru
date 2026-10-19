import { parseMediaReference } from './media-reference.js';
import { catalogEnabled, readingProvider } from './catalog-preferences.js';
import { isAraMedia } from './ara-ara.js';
const unavailable = () =>
  Object.assign(new Error('This title is unavailable.'), { status: 404, expose: true });
export function assertMediaEligible(media, context) {
  if (!media || !context || !['yoru', 'ara-ara'].includes(context.destination)) throw unavailable();
  const native = parseMediaReference(media.id)?.kind === 'extension-manga';
  if (native) {
    const source = media.sourceRef;
    if (
      !context.extensionsEnabled ||
      source?.integration !== 'suwayomi' ||
      !catalogEnabled(source.providerKey, context.destination, context.overrides)
    )
      throw unavailable();
    if (context.destination === 'yoru') {
      const rating = media.classification;
      const independent = [
        'title.contentRating',
        'manga.contentRating',
        'title.contentWarning',
        'manga.contentWarning',
      ].includes(rating?.provenance?.sourceField);
      if (
        media.isAdult ||
        rating?.rating !== 'safe' ||
        (!independent && source.classification?.rating !== 'safe')
      )
        throw unavailable();
    }
  } else {
    if (media.isAdult || (context.destination === 'ara-ara' && !isAraMedia(media)))
      throw unavailable();
  }
  return media;
}
export function assertSourceEligible(source, context, { discovery = false } = {}) {
  const integration = source?.integration || 'core';
  const provider = source?.providerKey || readingProvider(source?.id);
  if (
    !provider ||
    !catalogEnabled(provider, context.destination, context.overrides) ||
    (integration === 'suwayomi' && !context.extensionsEnabled) ||
    (discovery &&
      context.integrationMode !== 'all' &&
      context.integrationMode !== (integration === 'suwayomi' ? 'extensions' : 'core'))
  )
    throw unavailable();
  return source;
}
