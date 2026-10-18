import { useEffect, useState } from 'react';
import { useChapters } from './hooks';
import { chapterList, readerChapter, readingSources, savedReadingSource } from './requests';
export { savedReadingSource, rememberReadingSource } from './requests';

export function useReaderChapters(
  media,
  unit,
  requested,
  sourceParam,
  languageParam,
  scope = null,
) {
  const local = useChapters(media.id);
  const [sources, setSources] = useState(null);
  const [listing, setListing] = useState({ items: [], key: '', loading: false, error: '' });
  const [edition, setEdition] = useState({ item: null, key: '', loading: false, error: '' });
  const [revision, setRevision] = useState(0);
  const localSelected = requested
    ? local.items.some((x) => x.id === requested)
    : sourceParam === 'local' || (local.items.length > 0 && !sourceParam);
  const source = localSelected
    ? 'local'
    : requested?.startsWith('sw-')
      ? 'weebcentral'
      : requested && /^[a-f0-9-]{36}$/i.test(requested)
        ? 'mangadex'
        : sourceParam ||
          (sources?.sources.some((s) => s.id === savedReadingSource(media.id)) ||
          (sources?.partial && savedReadingSource(media.id) === 'weebcentral')
            ? savedReadingSource(media.id)
            : sources?.sources.find((s) => s.id === 'weebcentral')?.id || 'mangadex');
  const language =
    languageParam === 'all' || /^[a-z]{2}(?:-[a-z]{2,4})?$/.test(languageParam || '')
      ? languageParam
      : requested && edition.key === `${media.id}:${source}:${requested}`
        ? edition.item?.language || 'en'
        : 'en';
  const listingKey = `${media.id}:${source}:${language}`;
  useEffect(() => {
    const controller = new AbortController();
    setSources(null);
    readingSources(media.id, revision > 0)
      .then((result) => {
        if (!controller.signal.aborted) setSources(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSources({ sources: [], state: 'offline' });
      });
    return () => controller.abort();
  }, [media.id, revision]);
  const explicitChapter = /^(?:[a-f0-9-]{36}|sw-weebcentral-\d+-\d+)$/i.test(requested || '');
  // An exact edition can be verified by the reader endpoint without waiting for other providers.
  const enabled =
    !local.loading && !localSelected && (explicitChapter || sources?.state === 'ready');
  useEffect(() => {
    const controller = new AbortController();
    setListing((old) => ({
      items: [],
      key: listingKey,
      loading: !!enabled,
      error: '',
      languages: old.key.startsWith(`${media.id}:${source}:`) ? old.languages : [],
    }));
    if (!enabled) return () => controller.abort();
    (async () => {
      let offset = 0,
        items = [];
      // Fetch only the opened title. Keep the picker responsive while its editions load.
      for (let n = 0; n < 100; n++) {
        const result = await chapterList(
          media.id,
          { source, language, sort: 'asc', offset },
          scope,
          revision > 0,
        );
        items = [
          ...items,
          ...result.items
            .filter((c) => c.native && !c.external)
            .map((c) => ({
              ...c,
              kind: 'remote',
              group: c.groups.map((g) => g.name).join(', ') || c.readLabel,
              pageCount: c.pages,
              pages: [],
            })),
        ];
        if (controller.signal.aborted) return;
        setListing({
          items,
          key: listingKey,
          loading: false,
          error: '',
          languages: result.languages || [],
        });
        if (result.nextOffset == null || result.nextOffset <= offset) break;
        offset = result.nextOffset;
      }
    })().catch((e) => {
      if (!controller.signal.aborted)
        setListing((old) => ({ ...old, loading: false, error: e.message }));
    });
    return () => controller.abort();
  }, [enabled, media.id, source, language, revision, scope]);
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
    readerChapter(media.id, selected, revision > 0)
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
  let items = localSelected ? local.items : [];
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
    sources: [
      ...(sources?.sources || []),
      ...(!localSelected && source && sources && !sources.sources.some((s) => s.id === source)
        ? [
            {
              id: source,
              name:
                source === 'weebcentral' ? 'Weeb Central (unavailable)' : 'MangaDex (unavailable)',
            },
          ]
        : []),
      ...(local.items.length ? [{ id: 'local', name: 'On this device' }] : []),
    ],
    source,
    remote: !localSelected,
    language,
    languages: listing.languages || [],
    loading:
      local.loading ||
      (!loaded && !localSelected && !sources && !explicitChapter) ||
      (enabled &&
        !loaded &&
        (listing.key !== listingKey ||
          listing.loading ||
          (selected && (edition.key !== editionKey || edition.loading)))),
    error:
      local.error ||
      (enabled
        ? listing.error || edition.error
        : !localSelected && sources?.state === 'offline'
          ? 'The reading server is offline. Try again shortly.'
          : ''),
    refresh: () => {
      local.refresh();
      setRevision((n) => n + 1);
    },
  };
}
