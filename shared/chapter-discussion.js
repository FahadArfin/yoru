import { parseMediaReference, parseEditionReference } from './media-reference.js';

// Ordinary core chapters share one conversation across translations. Specials
// and native catalogs need their permanent edition ID to avoid thread collisions.
export function chapterDiscussionLink(mediaId, chapter) {
  const media = parseMediaReference(mediaId);
  if (!media || media.kind === 'anime' || !chapter) return null;
  const raw = String(chapter.number ?? '').trim();
  const number = raw ? Number(raw) : NaN;
  const numbered = Number.isFinite(number) && number >= 0 && number <= 100000;
  const params = new URLSearchParams();
  if (media.kind === 'manga' && numbered && Number.isInteger(number) && number > 0) {
    params.set('unit', String(number));
  } else {
    const edition = parseEditionReference(chapter.id);
    if (!edition || (media.kind === 'extension-manga') !== (edition.kind === 'extension'))
      return null;
    params.set('unit', media.kind === 'extension-manga' && numbered ? String(number) : '0');
    params.set('edition', edition.id);
    params.set('chapter', numbered ? String(number) : 'Special chapter');
  }
  return `/title/${mediaId}?${params}#chapter-discussion`;
}
