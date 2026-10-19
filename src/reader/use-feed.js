import { useCallback, useEffect, useRef, useState } from 'react';
import { readerRequest } from '../api';
import { useReaderSelection } from '../useCatalogPreferences';
import { useCollection } from '../collection-context';
import { mergeReadingPage, readingFeedKey } from './feed';

// One consumer owns its cursor chain. A new owner, destination or selection hides
// the old cards synchronously and aborts every in-flight request in that chain.
export function useReaderFeed(path) {
  const selection = useReaderSelection();
  const collection = useCollection();
  const allowed = !collection?.active || collection.confirmed;
  const context = selection?.ready && allowed ? selection.context : null;
  const key = readingFeedKey(context, path);
  const currentContext = useRef(context);
  currentContext.current = context;
  const [snapshot, setSnapshot] = useState({ key: null, data: null, loading: false, error: '' });
  const [revision, setRevision] = useState(0);
  const active = useRef(null);
  const refresh = useCallback(() => {
    void selection?.refresh();
    setRevision((n) => n + 1);
  }, [selection?.refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const chain = { key, controller, data: null, busy: false };
    active.current = chain;
    if (!key) return () => controller.abort();
    chain.load = async (cursor = null) => {
      if (chain.busy || controller.signal.aborted) return;
      chain.busy = true;
      setSnapshot({ key, data: chain.data, loading: true, error: '' });
      try {
        const requestContext = currentContext.current;
        if (readingFeedKey(requestContext, path) !== key) return;
        const url = new URL(path, 'https://yoru.local');
        if (cursor) url.searchParams.set('cursor', cursor);
        const page = await readerRequest(url.pathname + url.search, {
          ...requestContext,
          signal: controller.signal,
          force: revision > 0 || Boolean(cursor),
        });
        if (controller.signal.aborted || active.current !== chain) return;
        if (
          page.selectionFingerprint &&
          page.selectionFingerprint !== requestContext.selectionFingerprint
        )
          throw new Error('Reader choices changed. Refresh this catalog to continue.');
        const previousSources = cursor ? chain.data?.sources || [] : [];
        chain.data = mergeReadingPage(cursor ? chain.data : null, page);
        if (page.sources)
          chain.data.sources = [
            ...new Map(
              [...previousSources, ...page.sources].map((source) => [source.id, source]),
            ).values(),
          ];
        setSnapshot({ key, data: chain.data, loading: false, error: '' });
      } catch (error) {
        if (!controller.signal.aborted && active.current === chain)
          setSnapshot({ key, data: chain.data, loading: false, error: error.message });
      } finally {
        chain.busy = false;
      }
    };
    void chain.load();
    return () => controller.abort();
  }, [key, revision]);
  const loadMore = useCallback(() => {
    const chain = active.current;
    if (chain?.key === key && chain.data?.hasMore && chain.data.nextCursor)
      return chain.load(chain.data.nextCursor);
  }, [key]);
  const current = key && snapshot.key === key ? snapshot : null;
  return {
    data: current?.data || null,
    loading: Boolean(path && allowed && !selection?.error && (!key || !current || current.loading)),
    error: selection?.error || current?.error || '',
    refresh,
    loadMore,
    selection,
  };
}
