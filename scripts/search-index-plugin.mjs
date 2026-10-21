import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Ship only public suggestion fields, not the full editorial catalog.
export function searchIndexPlugin() {
  const id = 'virtual:search-index';
  return {
    name: 'yoru-search-index',
    resolveId(source) {
      if (source === id) return `\0${id}`;
    },
    load(source) {
      if (source !== `\0${id}`) return;
      const path = new URL('../server/seed.json', import.meta.url);
      this.addWatchFile(fileURLToPath(path));
      const seed = JSON.parse(readFileSync(path, 'utf8'));
      const fields = [
        'id',
        'title',
        'titleEnglish',
        'titleRomaji',
        'titleNative',
        'synonyms',
        'category',
        'format',
        'year',
        'episodes',
        'chapters',
        'cover',
        'popularity',
      ];
      const items = seed.items
        .filter((item) => !item.isAdult)
        .map((item) =>
          Object.fromEntries(
            fields.filter((field) => item[field] != null).map((field) => [field, item[field]]),
          ),
        );
      return `export default ${JSON.stringify(items)};`;
    },
  };
}
