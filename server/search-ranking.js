export const searchText = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function titleRelevance(item, query) {
  const needle = searchText(query);
  if (!needle) return 0;
  const words = needle.split(' ');
  return Math.max(
    -1,
    ...[item.title, item.titleEnglish, item.titleRomaji, item.titleNative, ...(item.synonyms || [])]
      .filter(Boolean)
      .map((title) => {
        const text = searchText(title);
        if (text === needle) return 10000;
        if (text.startsWith(needle)) return 8000 - Math.min(500, text.length - needle.length);
        if (text.includes(needle)) return 6000 - Math.min(500, text.length);
        if (words.every((word) => text.includes(word))) return 4000 - Math.min(500, text.length);
        return -1;
      }),
  );
}

export function rankSearch(items, query) {
  return [...items].sort(
    (a, b) =>
      titleRelevance(b, query) - titleRelevance(a, query) ||
      (a.popularity || Number.MAX_SAFE_INTEGER) - (b.popularity || Number.MAX_SAFE_INTEGER) ||
      String(a.title).localeCompare(String(b.title)),
  );
}
