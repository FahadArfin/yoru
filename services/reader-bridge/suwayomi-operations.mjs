// Fixed documents verified against the installed-schema fixture. This module is
// browser-safe: custom-server indexed browsing deliberately remains distinct.
const sourceFields =
  'id name displayName lang baseUrl homeUrl contentWarning isNsfw supportsLatest extension { pkgName isInstalled }';
const titleFields =
  'id sourceId url realUrl title thumbnailUrl description genre author artist status initialized';
const chapterFields =
  'id mangaId url realUrl name chapterNumber sourceOrder scanlator uploadDate pageCount';
export const operations = Object.freeze({
  sources: `query ExtensionSources($first:Int,$after:Cursor) { sources(first:$first,after:$after) { nodes { ${sourceFields} } pageInfo { hasNextPage endCursor } } }`,
  source: `query SourceById($id:LongString!) { source(id:$id) { ${sourceFields} } }`,
  remoteFeed: `mutation RemoteFeed($input:FetchSourceMangaInput!) { fetchSourceManga(input:$input) { hasNextPage mangas { ${titleFields} } } }`,
  details: `mutation RefreshDetails($input:FetchMangaInput!) { fetchManga(input:$input) { manga { ${titleFields} } } }`,
  bindingTitle: `query BindingTitle($id:Int!) { manga(id:$id) { ${titleFields} } }`,
  bindingTitles: `query BindingTitles($source:LongString!,$offset:Int!) { mangas(first:100,offset:$offset,filter:{sourceId:{equalTo:$source}}) { nodes { ${titleFields} } pageInfo { hasNextPage } } }`,
  extensionChapters: `mutation ExtensionChapters($input:FetchMangaAndChaptersInput!) { fetchMangaAndChapters(input:$input) { manga { ${titleFields} } chapters { ${chapterFields} } } }`,
  extensionPages: `mutation ExtensionPages($input:FetchChapterPagesInput!) { fetchChapterPages(input:$input) { chapter { ${chapterFields} manga { ${titleFields} } } pages } }`,
  CoreSearch:
    'mutation Search($input:FetchSourceMangaInput!) { fetchSourceManga(input:$input) { mangas { id title sourceId url realUrl } } }',
  CoreChapters:
    'mutation Chapters($id:Int!) { fetchMangaAndChapters(input:{id:$id,fetchManga:true,fetchChapters:true}) { manga { id sourceId realUrl } chapters { id mangaId name chapterNumber scanlator sourceOrder uploadDate pageCount } } }',
  CorePages:
    'mutation Pages($chapterId:Int!) { fetchChapterPages(input:{chapterId:$chapterId}) { chapter { id pageCount } pages } }',
  connectionSources:
    'query YoruSources { sources { nodes { id name lang isNsfw contentWarning supportsLatest } } }',
  connectionLegacySources: 'query YoruSources { sources { nodes { id name lang isNsfw } } }',
  indexedCatalog: `query YoruCatalog($source:LongString!,$query:String!,$offset:Int!) {
    mangas(first:20,offset:$offset,filter:{sourceId:{equalTo:$source},title:{includesInsensitive:$query}}) {
      nodes { id sourceId title genre } pageInfo { hasNextPage }
    }
  }`,
});

export const bridgeError = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });
export function decimalSourceId(value) {
  // LongString is signed 64 bit. Local-files zero is never an online catalog.
  if (typeof value !== 'string' || !/^-?[1-9]\d{0,18}$/.test(value)) return null;
  const integer = BigInt(value);
  return integer >= -9223372036854775808n && integer <= 9223372036854775807n ? value : null;
}
export function upstreamSourceId(value) {
  if (typeof value !== 'string' || !value.startsWith('suwayomi:'))
    throw bridgeError(400, 'Invalid extension source.');
  const id = decimalSourceId(value.slice(9));
  if (!id) throw bridgeError(400, 'Invalid extension source.');
  return id;
}
export function classification(row, now = Date.now()) {
  const known = { SAFE: 'safe', MIXED: 'mixed', NSFW: 'adult' };
  const hasWarning = Object.hasOwn(known, row?.contentWarning);
  // A legacy false flag cannot distinguish safe from mixed content.
  const rating = hasWarning
    ? known[row.contentWarning]
    : row?.isNsfw === true
      ? 'adult'
      : 'unknown';
  return {
    rating,
    provenance: {
      sourceField: hasWarning
        ? 'SourceType.contentWarning'
        : row?.isNsfw === true
          ? 'SourceType.isNsfw'
          : null,
      value: hasWarning ? row.contentWarning : row?.isNsfw === true ? true : null,
      checkedAt: new Date(now).toISOString(),
    },
  };
}
export function capabilities(row) {
  return {
    popular: 'unverified',
    latest: row?.supportsLatest === false ? 'unsupported' : 'unverified',
    search: 'unverified',
    details: 'unverified',
    chapters: 'unverified',
    pages: 'unverified',
    resolveLink: 'unsupported',
  };
}
export function normalizeSource(row, { now = Date.now(), bridgeInstance = null } = {}) {
  const id = decimalSourceId(row?.id);
  if (
    !id ||
    typeof row.name !== 'string' ||
    !row.name.trim() ||
    row.extension?.isInstalled === false
  )
    return null;
  return {
    id: `suwayomi:${id}`,
    integration: 'suwayomi',
    upstreamSourceId: id,
    providerKey: String(row.extension?.pkgName || row.name).slice(0, 200),
    language: String(row.lang || '').slice(0, 20),
    classification: classification(row, now),
    capabilities: capabilities(row),
    bridgeInstance,
    name: row.name.slice(0, 100),
  };
}
function canonicalUrl(value, base) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2048 ||
    /[\x00-\x20\\]/.test(value) ||
    value.startsWith('//')
  )
    return null;
  try {
    const url = new URL(value, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}
export function canonicalKey(value, source = {}, realUrl) {
  // Retain query strings and path case: these may be authoritative identities.
  const origin = canonicalUrl(source.baseUrl || source.homeUrl || realUrl)?.origin;
  const url = canonicalUrl(value, origin || 'https://canonical.invalid');
  if (!url || (origin && url.origin !== origin)) return null;
  if (!value.startsWith('/') && !/^https?:\/\//i.test(value)) return null;
  const path = url.pathname.replace(/\/$/, '') || '/';
  if (path === '/' && !url.search) return null;
  // Absolute keys without an independently known source origin stay absolute.
  return `${!origin && /^https?:\/\//i.test(value) ? url.origin : ''}${path}${url.search}`;
}
export function localInt(value) {
  const text = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^[1-9]\d{0,9}$/.test(text) || BigInt(text) > 2147483647n)
    throw bridgeError(409, 'The source binding needs verification.');
  return text;
}
export function normalizeTitle(row, sourceRef, rawSource) {
  if (row?.sourceId !== sourceRef.upstreamSourceId) return null;
  const key = canonicalKey(row.url, rawSource, row.realUrl);
  if (!key || typeof row.title !== 'string' || !row.title.trim()) return null;
  let id;
  try {
    id = localInt(row.id);
  } catch {
    return null;
  }
  return {
    sourceRef,
    upstreamRef: { sourceId: sourceRef.id, upstreamKey: key, language: sourceRef.language },
    localMangaId: id,
    classification: sourceRef.classification,
    metadata: {
      title: row.title.slice(0, 500),
      description: typeof row.description === 'string' ? row.description.slice(0, 20000) : null,
      genres: Array.isArray(row.genre)
        ? row.genre.filter((x) => typeof x === 'string').slice(0, 100)
        : [],
      author: typeof row.author === 'string' ? row.author.slice(0, 500) : null,
      artist: typeof row.artist === 'string' ? row.artist.slice(0, 500) : null,
      status: typeof row.status === 'string' ? row.status : null,
      category: 'MANGA',
      score: null,
      year: null,
      popularity: null,
      cover: null,
    },
  };
}
export function sourceState(sourceId, operation, state = 'ready', failure = null) {
  const status = failure?.status;
  return {
    sourceId,
    operation,
    state,
    status: status ? String(status) : null,
    retryAt: failure?.retryAt || null,
    reason:
      status === 401
        ? 'auth-required'
        : status === 403
          ? 'access-challenge'
          : status === 429
            ? 'rate-limited'
            : status === 404
              ? 'removed'
              : failure
                ? 'offline'
                : null,
    ...(failure?.retryAfter ? { retryAfter: failure.retryAfter } : {}),
  };
}
