import { useEffect, useState } from 'react';
import { useChapters } from './hooks';
import {
  chapterList,
  readerChapter,
  readingSources,
  savedReadingSource,
  readerContextKey,
  readerSourceAllowed,
} from './requests';
import { useReaderSelection } from '../useCatalogPreferences';
import { parseEditionReference, parseMediaReference } from '../../shared/media-reference';
import { readerSourceChoices } from './model';
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
  const selection = useReaderSelection();
  const context = selection?.ready ? selection.context : null;
  const contextKey = readerContextKey(context);
  const sourceKey = `${contextKey}:${media.id}`;
  const [sourceState, setSources] = useState({ key: '', data: null });
  const sources = sourceState.key === sourceKey ? sourceState.data : null;
  const [listing, setListing] = useState({ items: [], key: '', loading: false, error: '' });
  const [edition, setEdition] = useState({ item: null, key: '', loading: false, error: '' });
  const [revision, setRevision] = useState(0);
  const native = parseMediaReference(media.id)?.kind === 'extension-manga';
  const remoteRef = parseEditionReference(requested);
  const localSelected = requested
    ? local.items.some((item) => item.id === requested)
    : sourceParam === 'local' || (!native && local.items.length > 0 && !sourceParam);
  const source = localSelected
    ? 'local'
    : (remoteRef && remoteRef.kind !== 'extension' ? remoteRef.kind : null) ||
      sourceParam ||
      media.sourceRef?.id ||
      (sources?.sources.some((s) => s.id === savedReadingSource(media.id))
        ? savedReadingSource(media.id)
        : sources?.sources.find((s) => s.id === 'weebcentral')?.id ||
          sources?.sources[0]?.id ||
          'mangadex');
  const sourceChoice = sources?.sources.find(
    (s) => s.id === source && (!s.mediaId || s.mediaId === media.id),
  );
  const sourceRef = media.sourceRef?.id === source ? media.sourceRef : sourceChoice?.sourceRef;
  const pinned = {
    id: source,
    mediaId: media.id,
    sourceRef,
    integration: sourceRef?.integration || 'core',
    name:
      sourceRef?.providerKey ||
      (source === 'weebcentral'
        ? 'Weeb Central'
        : source === 'local'
          ? 'On this device'
          : 'MangaDex'),
  };
  const language =
    languageParam === 'all' || /^[a-z]{2}(?:-[a-z]{2,4})?$/.test(languageParam || '')
      ? languageParam
      : sourceRef?.language || 'en';
  const listingKey = `${sourceKey}:${source}:${language}`;
  const sourceAllowed = readerSourceAllowed(sourceRef || source, context);
  const enabled = !!context && !local.loading && !localSelected && sourceAllowed;
  const groupAllowed =
    !context ||
    context.integrationMode === 'all' ||
    context.integrationMode === (sourceRef?.integration === 'suwayomi' ? 'extensions' : 'core');

  useEffect(() => {
    const controller = new AbortController();
    if (!context) return () => controller.abort();
    readingSources(media.id, revision > 0, { ...context, signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setSources({ key: sourceKey, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setSources({
            key: sourceKey,
            data: { sources: [], state: 'offline', error: error.message },
          });
      });
    return () => controller.abort();
  }, [sourceKey, revision]);

  useEffect(() => {
    const controller = new AbortController();
    const shouldLoad =
      enabled &&
      groupAllowed &&
      (remoteRef || sources?.state === 'ready' || sources?.state === 'external-only');
    setListing({ items: [], key: listingKey, loading: !!shouldLoad, error: '', languages: [] });
    if (!shouldLoad) return () => controller.abort();
    (async () => {
      let offset = 0,
        page = 1,
        items = [];
      for (let n = 0; n < 100; n++) {
        const result = await chapterList(
          media.id,
          { source, sourceRef, language, sort: 'asc', offset, ...(native ? { page } : {}) },
          { ...context, signal: controller.signal },
          revision > 0,
        );
        if (controller.signal.aborted) return;
        items = [
          ...new Map(
            [
              ...items,
              ...(result.items || [])
                .filter((c) => c.native && !c.external)
                .map((c) => ({
                  ...c,
                  mediaId: c.mediaId || media.id,
                  sourceRef: c.sourceRef || sourceRef,
                  source: c.source || source,
                  kind: 'remote',
                  group: c.groups?.map((g) => g.name).join(', ') || c.readLabel || '',
                  pageCount: c.pageCount || c.pages,
                  pages: [],
                })),
            ].map((c) => [c.id, c]),
          ).values(),
        ];
        setListing({
          items,
          key: listingKey,
          loading: false,
          error: '',
          languages: result.languages || [...new Set(items.map((c) => c.language).filter(Boolean))],
        });
        if (native) {
          if (!result.hasMore || !result.nextPage || result.nextPage <= page) break;
          page = result.nextPage;
        } else {
          if (result.nextOffset == null || result.nextOffset <= offset) break;
          offset = result.nextOffset;
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted)
        setListing((old) => ({ ...old, loading: false, error: error.message }));
    });
    return () => controller.abort();
  }, [enabled, groupAllowed, listingKey, sources?.state, revision]);

  const availableChapters = listing.key === listingKey ? listing.items : [];
  const selected = enabled
    ? requested ||
      (!native
        ? availableChapters.find((c) => c.number === String(unit))?.id || availableChapters[0]?.id
        : null)
    : null;
  const editionKey = `${sourceKey}:${source}:${selected}`;
  useEffect(() => {
    const controller = new AbortController();
    setEdition({ item: null, key: editionKey, loading: !!selected, error: '' });
    if (!selected) return () => controller.abort();
    readerChapter(media.id, { id: selected, sourceRef, source }, revision > 0, {
      ...context,
      signal: controller.signal,
    })
      .then((item) => {
        if (!controller.signal.aborted)
          setEdition({ item, key: editionKey, loading: false, error: '' });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setEdition({ item: null, key: editionKey, loading: false, error: error.message });
      });
    return () => controller.abort();
  }, [editionKey, revision]);
  const loaded = !!(selected && edition.key === editionKey && edition.item?.id === selected);
  const items = localSelected
    ? local.items
    : loaded
      ? [...availableChapters.filter((c) => c.id !== selected), edition.item].sort(
          (a, b) =>
            (availableChapters.findIndex((c) => c.id === a.id) + 1 || Infinity) -
            (availableChapters.findIndex((c) => c.id === b.id) + 1 || Infinity),
        )
      : [];
  return {
    ...local,
    items,
    localItems: local.items,
    availableChapters: localSelected ? local.items : availableChapters,
    groupEmpty: sources?.state === 'ready' && !sources.sources.length,
    context,
    sourceRef,
    source,
    remote: !localSelected,
    language,
    sources: readerSourceChoices(
      [
        ...(sources?.sources || []),
        ...(local.items.length ? [{ id: 'local', name: 'On this device', mediaId: media.id }] : []),
      ],
      context,
      sourceAllowed ? pinned : null,
    ),
    languages: listing.key === listingKey ? listing.languages || [] : [],
    loading:
      local.loading ||
      (!!context &&
        !localSelected &&
        !loaded &&
        ((!sources && !remoteRef) ||
          (enabled &&
            (listing.key !== listingKey ||
              listing.loading ||
              (selected && (edition.key !== editionKey || edition.loading)))))),
    error:
      local.error ||
      (!localSelected && !sourceAllowed && context
        ? 'This chapter source is disabled for this section. Choose another source or change Reader catalogs in Settings.'
        : !localSelected && sources?.state === 'offline' && !loaded
          ? sources.error || 'The reading server is offline. Try again shortly.'
          : (edition.key === editionKey ? edition.error : '') ||
            (listing.key === listingKey ? listing.error : '')),
    refresh: () => {
      local.refresh();
      setRevision((n) => n + 1);
    },
  };
}
