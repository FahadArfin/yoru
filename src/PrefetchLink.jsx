import React, { useEffect, useRef } from 'react';
import { Link } from './collection-router';
import { cachedApi, readerRequest } from './api';
import { useApp } from './state';
import { useReaderSelection } from './useCatalogPreferences';
import { collectionPath, useCollection } from './collection-context';
import { canPreload, coverCandidates, warmImage } from './image-loading';
import { recommendationQuery, relatedTitles } from './recommendations';
import { chapterList, readingSources, savedReadingSource, warmReaderLink } from './reader/requests';

let active = 0;
export async function warmTitle(media, scope, signal, context) {
  if (!canPreload() || signal?.aborted || active >= 2 || !media?.id) return;
  if (!context?.selectionFingerprint || (context.expiresAt && context.expiresAt <= Date.now()))
    return;
  active++;
  try {
    const data = await readerRequest(`/api/media/${media.id}`, { ...context, signal });
    const title = data.media || data;
    if (signal?.aborted || !canPreload()) return;
    warmImage(coverCandidates(title, context)[0], signal);
    // Exact native chapter preloading belongs to the edition reader. Never guess
    // a dedicated adapter or MAL lookup for a source-native title on hover.
    if (/^ext-manga-[a-f0-9]{32}$/.test(title.id)) return;
    if (!['MANGA', 'MANHWA'].includes(title.category)) return;
    await Promise.allSettled([
      (recommendationQuery(title)
        ? cachedApi(recommendationQuery(title))
        : Promise.resolve({ items: [] })
      ).then((result) => {
        if (!signal?.aborted)
          relatedTitles(title, result.items, context)
            .slice(0, 4)
            .forEach((item) => warmImage(coverCandidates(item, context)[0], signal));
      }),
      (async () => {
        const current = { ...context, signal };
        const result = await readingSources(title.id, false, current);
        if (!result.sources.length) return;
        if (signal?.aborted || !canPreload()) return;
        const preferred = savedReadingSource(title.id);
        const source =
          result.sources.find((s) => s.id === preferred) ||
          result.sources.find((s) => s.id === 'weebcentral') ||
          result.sources[0];
        await chapterList(
          source.mediaId || title.id,
          { source: source.id, sourceRef: source.sourceRef },
          current,
        );
      })(),
    ]);
  } catch {
    /* A hover must never surface an error or prevent navigation. */
  } finally {
    active--;
  }
}

export default function PrefetchLink({
  media,
  to,
  onFocus,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  ...props
}) {
  const { user, authLoading, authKnown } = useApp();
  const selection = useReaderSelection();
  const collection = useCollection();
  const timer = useRef();
  const pending = useRef();
  const begin = () => {
    clearTimeout(timer.current);
    if (
      authLoading ||
      !authKnown ||
      !selection?.ready ||
      (collection?.active && !collection.confirmed)
    )
      return;
    if (pending.current && !pending.current.signal.aborted) return;
    const controller = new AbortController();
    pending.current = controller;
    const job = media
      ? warmTitle(media, user?.id || 'guest', controller.signal, selection.context)
      : typeof to === 'string'
        ? warmReaderLink(
            collectionPath(to, collection?.active),
            controller.signal,
            2,
            selection.context,
          )
        : Promise.resolve();
    job.finally(() => {
      if (pending.current === controller) pending.current = null;
    });
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      pending.current?.abort();
    },
    [
      to,
      user?.id,
      authLoading,
      authKnown,
      selection?.ready,
      selection?.context?.destination,
      selection?.context?.selectionFingerprint,
    ],
  );
  return (
    <Link
      {...props}
      to={to}
      onFocus={(event) => {
        onFocus?.(event);
        begin();
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        begin();
      }}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        timer.current = setTimeout(begin, 120);
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        clearTimeout(timer.current);
      }}
    />
  );
}
