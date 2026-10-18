export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
export const naturalCompare = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
const text = (value, max = 160) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '';
export function publicPageUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !host.includes('.') ||
      /^[\d.]+$/.test(host) ||
      host.includes(':') ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export function parseManifest(value) {
  if (typeof value === 'string') {
    if (value.length > MAX_MANIFEST_BYTES)
      throw new Error('Choose a chapter manifest smaller than 2 MB.');
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error('This file is not valid JSON.');
    }
  }
  if (!value || typeof value !== 'object' || !value.chapters || typeof value.chapters !== 'object')
    throw new Error('The manifest needs a chapters collection.');
  const rows = [];
  const collection = text(value.title, 120) || 'Imported collection';
  const entries = Array.isArray(value.chapters)
    ? value.chapters.map((chapter, index) => [
        text(chapter?.number ?? chapter?.chapter ?? index + 1, 60),
        chapter,
      ])
    : Object.entries(value.chapters);
  let pageCount = 0;
  for (const [key, chapter] of entries) {
    if (!chapter || typeof chapter !== 'object')
      throw new Error('Every chapter needs page information.');
    const number = text(key, 60);
    const language = text(chapter.language || value.language, 24) || 'und';
    const volume = text(chapter.volume, 40);
    const groups = chapter.groups || { [text(chapter.group) || 'Imported edition']: chapter.pages };
    if (!groups || typeof groups !== 'object' || Array.isArray(groups))
      throw new Error('A chapter needs a group and page list.');
    for (const [groupName, values] of Object.entries(groups)) {
      if (!Array.isArray(values) || !values.length || values.length > 500)
        throw new Error('Each chapter needs between 1 and 500 pages.');
      const group = text(groupName);
      const pages = values.map((page) => {
        const url = publicPageUrl(typeof page === 'string' ? page : page?.url);
        if (!url) throw new Error('Page links must be public HTTPS URLs without credentials.');
        const width = Math.min(20000, Math.max(0, Number(page?.width) || 0));
        const height = Math.min(100000, Math.max(0, Number(page?.height) || 0));
        return { url, width, height };
      });
      pageCount += pages.length;
      if (rows.length >= 500 || pageCount > 10000)
        throw new Error('Import at most 500 editions and 10,000 pages at a time.');
      const id = ['manifest', collection, volume, number, language, group]
        .map(encodeURIComponent)
        .join(':');
      if (rows.some((row) => row.id === id))
        throw new Error('The manifest contains duplicate chapter editions.');
      rows.push({
        id,
        number,
        volume,
        language,
        group,
        title: text(chapter.title),
        pages,
        origin: 'manifest',
      });
    }
  }
  if (!rows.length) throw new Error('No chapters were found in this manifest.');
  return sortChapters(rows);
}
function compareChapterNumbers(left, right) {
  const a = chapterUnit(left),
    b = chapterUnit(right);
  if (a !== null && b !== null) return a - b;
  if (a !== null) return -1;
  if (b !== null) return 1;
  return naturalCompare(left, right);
}
export const sortChapters = (chapters) =>
  [...chapters].sort(
    (a, b) =>
      naturalCompare(a.volume, b.volume) ||
      compareChapterNumbers(a.number, b.number) ||
      naturalCompare(a.group, b.group),
  );
export function filterChapters(chapters, filters = {}, states = {}) {
  const query = (filters.query || '').trim().toLowerCase();
  const rows = sortChapters(chapters).filter((chapter) => {
    const state = states[chapter.id] || {};
    return (
      (!filters.language || filters.language === 'all' || chapter.language === filters.language) &&
      (!filters.volume || filters.volume === 'all' || chapter.volume === filters.volume) &&
      (filters.status !== 'unread' || !state.read) &&
      (filters.status !== 'read' || state.read) &&
      (filters.status !== 'bookmarked' || Boolean(state.bookmark)) &&
      (!query ||
        `${chapter.number} ${chapter.title} ${chapter.group}`.toLowerCase().includes(query))
    );
  });
  return filters.sort === 'desc' ? rows.reverse() : rows;
}
export function readerPreferences(saved = {}, category = 'MANGA') {
  saved = saved && typeof saved === 'object' ? saved : {};
  const choose = (key, options, fallback) => (options.includes(saved[key]) ? saved[key] : fallback);
  const mode = choose(
    'mode',
    ['single', 'double', 'vertical', 'webtoon'],
    category === 'MANHWA' ? 'webtoon' : 'single',
  );
  const fit = choose(
    'fit',
    ['both', 'width', 'height', 'original'],
    category === 'MANHWA' ? 'width' : 'both',
  );
  return {
    mode,
    direction: choose('direction', ['rtl', 'ltr'], category === 'MANHWA' ? 'ltr' : 'rtl'),
    fit: !['single', 'double'].includes(mode) && ['both', 'height'].includes(fit) ? 'width' : fit,
    width: Math.min(1600, Math.max(400, Number(saved.width) || 900)),
    background: choose('background', ['dark', 'black', 'sepia', 'light'], 'dark'),
    gap: Math.min(48, Math.max(0, Number.isFinite(Number(saved.gap)) ? Number(saved.gap) : 16)),
  };
}
export function pageStep(page, direction, total, mode) {
  if (direction > 0 && mode === 'double' && page + 1 >= total) return page;
  return Math.max(1, Math.min(Math.max(1, total), page + direction * (mode === 'double' ? 2 : 1)));
}
export function chapterUnit(value) {
  if (!/^\d+(\.\d+)?$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number <= 100000 ? number : null;
}
export function readerLink(mediaId, chapter, page) {
  const number = chapter && /^\d+(\.\d+)?$/.test(chapter.number) ? chapter.number : '1';
  const params = new URLSearchParams();
  if (chapter?.id) params.set('chapter', chapter.id);
  if (chapter?.kind === 'remote' && chapter.language) params.set('language', chapter.language);
  if (page) params.set('page', String(page));
  return `/read/${mediaId}/${number}${params.size ? `?${params}` : ''}`;
}
export function languageName(language) {
  if (!language || language === 'und') return 'Unspecified language';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(language);
  } catch {
    return language;
  }
}
