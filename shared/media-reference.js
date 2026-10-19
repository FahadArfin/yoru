// JSON Schema and runtime validation share the exact same public title namespace.
const MEDIA_PATTERN = '^(?:mal-(?:anime|manga)-[1-9]\\d{0,8}|ext-manga-[0-9a-f]{32})$(?![\\s\\S])';
const MEDIA = new RegExp(MEDIA_PATTERN);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$(?![\s\S])/i;
const WEEB_CENTRAL = /^sw-weebcentral-[1-9]\d{0,9}-[1-9]\d{0,9}$(?![\s\S])/i;
const EXTENSION_CHAPTER = /^ext-chapter-[0-9a-f]{32}$(?![\s\S])/;

export const mediaReferenceSchema = Object.freeze({ type: 'string', pattern: MEDIA_PATTERN });

/** @returns {import('./reading-contracts.js').MediaRef|null} */
export function parseMediaReference(value) {
  if (typeof value !== 'string' || !MEDIA.test(value)) return null;
  const kind = value.startsWith('ext-')
    ? 'extension-manga'
    : value.startsWith('mal-anime-')
      ? 'anime'
      : 'manga';
  return { id: value, kind };
}

/** Device imports deliberately retain their separate parser and namespace.
 * @returns {import('./reading-contracts.js').EditionRef|null}
 */
export function parseEditionReference(value) {
  if (typeof value !== 'string') return null;
  if (EXTENSION_CHAPTER.test(value)) return { id: value, kind: 'extension' };
  if (UUID.test(value)) return { id: value, kind: 'mangadex' };
  if (WEEB_CENTRAL.test(value)) return { id: value, kind: 'weebcentral' };
  return null;
}
