import { assertMediaEligible, assertSourceEligible } from '../../shared/reading-eligibility.js';
export function readingSuggestions(items, context, category = 'all') {
  if (!context) return [];
  const seen = new Set();
  return items
    .filter((item) => {
      if (
        !item?.id ||
        seen.has(item.id) ||
        (category !== 'all' && item.category?.toLowerCase() !== category)
      )
        return false;
      try {
        assertMediaEligible(item, { ...context, extensionsEnabled: true });
        if (item.sourceRef)
          assertSourceEligible(
            item.sourceRef,
            { ...context, extensionsEnabled: true },
            { discovery: true },
          );
        else if (item.category !== 'ANIME' && context.integrationMode === 'extensions')
          return false;
      } catch {
        return false;
      }
      seen.add(item.id);
      return true;
    })
    .slice(0, 12);
}

export const readingFeedKey = (context, path) =>
  context && path
    ? JSON.stringify([
        context.owner,
        context.destination,
        context.integrationMode,
        context.selectionFingerprint,
        path,
      ])
    : null;
export function visibleReadingItems(
  items,
  { context, category = 'manga', genre = '', source = '', language = '' } = {},
) {
  if (!context) return [];
  return items.filter((item) => {
    if (
      item.category === 'ANIME' ||
      (category === 'manhwa' && item.category !== 'MANHWA') ||
      (genre &&
        !item.genres?.some(
          (value) => typeof value === 'string' && value.toLowerCase() === genre.toLowerCase(),
        ))
    )
      return false;
    try {
      assertMediaEligible(item, { ...context, extensionsEnabled: true });
    } catch {
      return false;
    }
    // Core metadata already has its own editorial surface. Keep it in the feed
    // state so a later exact native choice can reveal this same representative.
    const sources = [
      item.sourceRef,
      ...(item.readingChoices || []).map((choice) => choice.sourceRef),
    ].filter(Boolean);
    return sources.some((candidate) => {
      if (
        candidate.integration !== 'suwayomi' ||
        (source && source !== candidate.id) ||
        (language && language !== candidate.language)
      )
        return false;
      try {
        assertSourceEligible(
          candidate,
          { ...context, extensionsEnabled: true },
          { discovery: true },
        );
        return true;
      } catch {
        return false;
      }
    });
  });
}

// Continuation patches carry only newly eligible choices, never representative metadata.
// Apply even a terminal empty page, retaining both display order and exact reader selection.
export function mergeReadingPage(previous, page) {
  const items = [...(previous?.items || [])];
  const positions = new Map(items.map((item, index) => [item.id, index]));
  for (const item of page.items || []) {
    if (!positions.has(item.id)) {
      positions.set(item.id, items.length);
      items.push(item);
    }
  }
  for (const update of page.updates || []) {
    const position = positions.get(update.id);
    if (position === undefined) continue;
    const card = items[position];
    const choices = new Map((card.readingChoices || []).map((choice) => [choice.mediaId, choice]));
    for (const choice of update.readingChoices || []) choices.set(choice.mediaId, choice);
    const readingChoices = [...choices.values()];
    items[position] = {
      ...card,
      readingChoices,
      availableIntegrations: [...new Set(readingChoices.map((choice) => choice.integration))],
    };
  }
  return { ...page, items };
}
