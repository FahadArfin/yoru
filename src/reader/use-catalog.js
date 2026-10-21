import { useState } from 'react';
import { useReaderFeed } from './use-feed';
import { assertSourceEligible } from '../../shared/reading-eligibility';
import { visibleReadingItems } from './feed';

// One cursor chain serves the landing banner, highlights and catalog together.
export function useReaderCatalog({
  category = 'manga',
  query = '',
  genre = '',
  source: initialSource = '',
  language: initialLanguage = '',
  enabled = true,
} = {}) {
  const [source, setSource] = useState(initialSource);
  const [language, setLanguage] = useState(initialLanguage);
  const [sort, setSort] = useState('popular');
  const [genreChoice, setGenreChoice] = useState({ base: genre, value: genre });
  if (genreChoice.base !== genre) setGenreChoice({ base: genre, value: genre });
  // URL genre changes take effect during render; local chips can override that
  // URL until the visitor navigates to a different genre.
  const selectedGenre = genreChoice.base === genre ? genreChoice.value : genre;
  const setGenre = (value) => setGenreChoice({ base: genre, value });
  const parameters = new URLSearchParams({ mode: query ? 'search' : sort, q: query, limit: '24' });
  if (source) parameters.set('source', source);
  if (language) parameters.set('language', language);
  const feed = useReaderFeed(
    enabled ? `/api/reader/${query ? 'browse' : 'discovery'}?${parameters}` : null,
  );
  const inventory = useReaderFeed(enabled ? '/api/reader/catalogs?limit=100' : null);
  const selection = feed.selection;
  const context = selection?.context;
  const sources = (inventory.data?.sources || []).filter((item) => {
    if (!context) return false;
    try {
      assertSourceEligible(item, { ...context, extensionsEnabled: true }, { discovery: true });
      return true;
    } catch {
      return false;
    }
  });
  const allItems = visibleReadingItems(feed.data?.items || [], {
    context,
    category,
    source,
    language,
  });
  const items = visibleReadingItems(allItems, {
    context,
    category,
    source,
    language,
    genre: selectedGenre,
  });
  const genres = [
    ...new Set(
      allItems
        .flatMap((item) => (Array.isArray(item.genres) ? item.genres : []))
        .filter((value) => typeof value === 'string' && value.trim() && value.length <= 128),
    ),
  ].sort((a, b) => a.localeCompare(b));
  return {
    feed,
    inventory,
    selection,
    context,
    sources,
    allItems,
    items,
    genres,
    languages: [...new Set(sources.map((item) => item.language).filter(Boolean))].sort(),
    source,
    setSource,
    language,
    setLanguage,
    sort,
    setSort,
    genre: selectedGenre,
    setGenre,
    partial: feed.data?.sourceStates?.some((item) => !['ready', 'empty'].includes(item.state)),
  };
}
