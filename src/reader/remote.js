import { useEffect, useState } from 'react';
import { api } from '../api';
import { useChapters } from './hooks';

export function savedReadingSource(id) {
  try {
    return localStorage.getItem(`yoru:reading-source:${id}`) || '';
  } catch {
    return '';
  }
}
export function rememberReadingSource(id, source) {
  try {
    localStorage.setItem(`yoru:reading-source:${id}`, source);
  } catch {
    /* Device storage is optional. */
  }
}
export function useReaderChapters(media, unit, requested, sourceParam, languageParam) {
  const local = useChapters(media.id);
  const [sources, setSources] = useState(null);
  const [listing, setListing] = useState({ items: [], key: '', loading: false, error: '' });
  const [edition, setEdition] = useState({ item: null, key: '', loading: false, error: '' });
  const [revision, setRevision] = useState(0);
  const localSelected = requested
    ? local.items.some((x) => x.id === requested)
    : local.items.length > 0 && !sourceParam;
  const source = requested?.startsWith('sw-')
    ? 'weebcentral'
    : requested && /^[a-f0-9-]{36}$/i.test(requested)
      ? 'mangadex'
      : sourceParam ||
        (sources?.sources.some((s) => s.id === savedReadingSource(media.id))
          ? savedReadingSource(media.id)
          : sources?.sources.find((s) => s.id === 'weebcentral')?.id || 'mangadex');
  const language = /^[a-z]{2}(?:-[a-z]{2,4})?$/.test(languageParam || '')
    ? languageParam
    : requested && edition.key === `${media.id}:${source}:${requested}`
      ? edition.item?.language || 'en'
      : 'en';
  const listingKey = `${media.id}:${source}:${language}`;
  useEffect(() => {
    const controller = new AbortController();
    setSources(null);
    api(`/api/media/${media.id}/reading-sources`, { signal: controller.signal })
      .then(setSources)
      .catch(() => {
        if (!controller.signal.aborted) setSources({ sources: [], state: 'offline' });
      });
    return () => controller.abort();
  }, [media.id, revision]);
  const enabled = !local.loading && !localSelected && sources?.state === 'ready';
  useEffect(() => {
    const controller = new AbortController();
    setListing({ items: [], key: listingKey, loading: !!enabled, error: '' });
    if (!enabled) return () => controller.abort();
    (async () => {
      let offset = 0,
        items = [];
      // Fetch only the opened title. Keep the picker responsive while its editions load.
      for (let n = 0; n < 100; n++) {
        const result = await api(
          `/api/media/${media.id}/chapters?${new URLSearchParams({ source, language, sort: 'asc', offset: String(offset) })}`,
          { signal: controller.signal },
        );
        items = [
          ...items,
          ...result.items
            .filter((c) => c.native && !c.external)
            .map((c) => ({
              ...c,
              kind: 'remote',
              group: c.groups.map((g) => g.name).join(', ') || c.readLabel,
              pages: [],
            })),
        ];
        if (controller.signal.aborted) return;
        setListing({ items, key: listingKey, loading: false, error: '' });
        if (result.nextOffset == null || result.nextOffset <= offset) break;
        offset = result.nextOffset;
      }
    })().catch((e) => {
      if (!controller.signal.aborted)
        setListing((old) => ({ ...old, loading: false, error: e.message }));
    });
    return () => controller.abort();
  }, [enabled, media.id, source, language, revision]);
  const selected = enabled
    ? requested ||
      (listing.key === listingKey
        ? listing.items.find((c) => c.number === String(unit))?.id || listing.items[0]?.id
        : null)
    : null;
  const editionKey = `${media.id}:${source}:${selected}`;
  useEffect(() => {
    const controller = new AbortController();
    setEdition({ item: null, key: editionKey, loading: !!selected, error: '' });
    if (!selected) return () => controller.abort();
    api(`/api/media/${media.id}/reader/${encodeURIComponent(selected)}`, {
      signal: controller.signal,
    })
      .then((item) => {
        if (!controller.signal.aborted)
          setEdition({ item, key: editionKey, loading: false, error: '' });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setEdition({ item: null, key: editionKey, loading: false, error: e.message });
      });
    return () => controller.abort();
  }, [selected, media.id, source, revision]);
  let items = local.items;
  const loaded = !!(
    selected &&
    edition.item &&
    edition.key === editionKey &&
    edition.item.id === selected
  );
  if (enabled) {
    items = listing.key === listingKey ? listing.items : [];
    if (loaded)
      items = items.some((c) => c.id === selected)
        ? items.map((c) => (c.id === selected ? edition.item : c))
        : [...items, edition.item];
    // Metadata is not a loaded chapter; never mount the canvas with an empty page list.
    if (!loaded) items = [];
  }
  return {
    ...local,
    items,
    sources: sources?.sources || [],
    source,
    remote: enabled,
    loading:
      local.loading ||
      (!localSelected && !sources) ||
      (enabled &&
        !loaded &&
        (listing.key !== listingKey ||
          listing.loading ||
          (selected && (edition.key !== editionKey || edition.loading)))),
    error:
      local.error ||
      (enabled
        ? listing.error || edition.error
        : sources?.state === 'offline' && requested
          ? 'The reading server is offline. Try again shortly.'
          : ''),
    refresh: () => {
      local.refresh();
      setRevision((n) => n + 1);
    },
  };
}
