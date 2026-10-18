import React, { useEffect, useRef } from 'react';
import { Link } from './collection-router';
import { cachedApi } from './api';
import { useApp } from './state';
import { canPreload, coverCandidates, warmImage } from './image-loading';
import { recommendationQuery, relatedTitles } from './recommendations';
import {
  chapterListPath,
  readingSources,
  savedReadingSource,
  warmReaderLink,
} from './reader/requests';

let active = 0;
export async function warmTitle(media, scope, signal) {
  if (!canPreload() || signal?.aborted || active >= 2 || !media?.id) return;
  active++;
  try {
    const data = await cachedApi(`/api/media/${media.id}`);
    const title = data.media || data;
    if (signal?.aborted || !canPreload()) return;
    warmImage(coverCandidates(title)[0], signal);
    if (!['MANGA', 'MANHWA'].includes(title.category)) return;
    await Promise.allSettled([
      (recommendationQuery(title)
        ? cachedApi(recommendationQuery(title))
        : Promise.resolve({ items: [] })
      ).then((result) => {
        if (!signal?.aborted)
          relatedTitles(title, result.items)
            .slice(0, 4)
            .forEach((item) => warmImage(coverCandidates(item)[0], signal));
      }),
      (async () => {
        const result = await readingSources(title.id);
        if (signal?.aborted || !canPreload()) return;
        const preferred = savedReadingSource(title.id);
        const source = result.sources.some((s) => s.id === preferred)
          ? preferred
          : result.sources.find((s) => s.id === 'weebcentral')?.id || 'mangadex';
        await cachedApi(chapterListPath(title.id, { source }), false, { scope, ttl: 30000 });
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
  const timer = useRef();
  const pending = useRef();
  const begin = () => {
    clearTimeout(timer.current);
    if (authLoading || !authKnown) return;
    if (pending.current && !pending.current.signal.aborted) return;
    const controller = new AbortController();
    pending.current = controller;
    const job = media
      ? warmTitle(media, user?.id || 'guest', controller.signal)
      : typeof to === 'string'
        ? warmReaderLink(to, controller.signal)
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
    [to, user?.id, authLoading, authKnown],
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
