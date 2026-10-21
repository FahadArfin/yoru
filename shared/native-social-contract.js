import { parseMediaReference, parseEditionReference } from './media-reference.js';
import { roomReaderPath } from './room-reader.js';

// Unit numbers are display metadata. Only an explicit permanent edition may
// identify a native chapter, including chapter zero and specials.
export function discussionReference(mediaId, unit = 0, edition = null) {
  const ref = parseMediaReference(mediaId);
  const number = Number(unit);
  if (
    !ref ||
    !Number.isFinite(number) ||
    number < 0 ||
    number > 100000 ||
    (ref.kind !== 'extension-manga' && !Number.isInteger(number))
  )
    return null;
  const editionId = edition || null;
  const chapter = editionId ? parseEditionReference(editionId) : null;
  if (editionId && (!chapter || ref.kind === 'anime')) return null;
  if (ref.kind === 'extension-manga') {
    if ((!editionId && number !== 0) || (editionId && chapter.kind !== 'extension')) return null;
  } else if (chapter?.kind === 'extension') return null;
  return { mediaId, unit: number, editionId, isTitle: number === 0 && !editionId };
}

export const discussionKey = ({ mediaId, unit, editionId }) => `${mediaId}:${editionId || unit}`;
export const roomDestination = (room) => room?.destination || 'yoru';
export function publicSocialMedia(media) {
  if (parseMediaReference(media?.id)?.kind === 'extension-manga') return media;
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
    'episodes',
    'chapters',
    'volumes',
    'score',
    'averageScore',
    'rating',
    'year',
    'startDate',
    'endDate',
    'season',
    'popularity',
    'rank',
    'malId',
    'idMal',
    'isAdult',
    'subCount',
    'dubCount',
    'hasDub',
  ])
    if (['string', 'number', 'boolean'].includes(typeof media?.[key]) || media?.[key] === null)
      result[key] = media[key];
  for (const key of ['genres', 'tags'])
    if (Array.isArray(media?.[key]))
      result[key] = media[key].filter((item) => typeof item === 'string');
  for (const key of ['cover', 'coverImage', 'image', 'banner']) {
    let value = '';
    try {
      const url = new URL(media?.[key]);
      const host = url.hostname.toLowerCase();
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !host.includes(':') &&
        !/^(?:0|10|127|169\.254|192\.168)\./.test(host) &&
        !/^172\.(?:1[6-9]|2\d|3[01])\./.test(host) &&
        host.includes('.') &&
        !/(?:^|\.)(?:localhost|local|internal|invalid)$/.test(host)
      )
        value = url.href;
    } catch {
      /* Unknown URLs remain absent from public social metadata. */
    }
    if (media?.[key] !== undefined) result[key] = value;
  }
  return result;
}
export function roomReferenceEligible(room, media, destination) {
  if (!room || roomDestination(room) !== destination) return false;
  if (parseMediaReference(media?.id)?.kind !== 'extension-manga') return true;
  if (room.type !== 'read') return false;
  if (!room.reader_edition_id)
    return Number(room.unit) === 0 && !room.source_url && !room.reader_source_id;
  if (room.source_kind !== 'reader' || room.reader_source_id !== media.sourceRef?.id) return false;
  const path = roomReaderPath(room.source_url, media.id, room.unit, { destination });
  if (!path) return false;
  const url = new URL(path, 'https://yoru.invalid');
  return (
    url.searchParams.get('source') === room.reader_source_id &&
    url.searchParams.get('chapter') === room.reader_edition_id
  );
}
export function socialDestination(input = {}) {
  if (input.destination !== undefined && !['yoru', 'ara-ara'].includes(input.destination))
    return null;
  if (input.collection === 'ara-ara')
    return input.destination && input.destination !== 'ara-ara' ? null : 'ara-ara';
  return input.destination || 'yoru';
}
