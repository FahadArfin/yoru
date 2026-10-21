import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { api } from '../api';
import { readerContextKey, readerContextPath, readerMutation } from './requests';
import { READER_EVENT, prepareReaderMarkers, mergeReaderMarkers } from './storage';

export function useMarkerSync(id) {
  const { user, authKnown, readingContext } = useApp();
  const owner = user?.id;
  const key = readerContextKey(readingContext);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    if (!owner || !authKnown || !readingContext || !id) return;
    const controller = new AbortController();
    const context = { ...readingContext, signal: controller.signal };
    const requestContext = () => ({
      ...context,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    });
    let running = false,
      again = false,
      timer;
    const sync = async () => {
      if (controller.signal.aborted) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        const pending = prepareReaderMarkers(owner, id);
        for (const [chapterId, fields] of Object.entries(pending))
          for (const [field, item] of Object.entries(fields)) {
            if (!['bookmark', 'read'].includes(field)) continue;
            const result = await readerMutation(
              `/api/reader-markers/${encodeURIComponent(id)}`,
              {
                owner,
                chapterId,
                [field]: item.value,
                updatedAt: item.at,
              },
              'PUT',
              requestContext(),
            );
            if (!controller.signal.aborted)
              mergeReaderMarkers(owner, id, result.chapters, { chapterId, field, at: item.at });
          }
        const result = await api(
          readerContextPath(`/api/reader-markers/${encodeURIComponent(id)}`, context),
          { signal: requestContext().signal },
        );
        if (!controller.signal.aborted) {
          mergeReaderMarkers(owner, id, result.chapters);
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            'Bookmarks are saved on this device. Account sync will retry when the connection is available.',
          );
      } finally {
        running = false;
        if (again && !controller.signal.aborted) {
          again = false;
          timer = setTimeout(sync, 250);
        }
      }
    };
    const changed = (event) => {
      if (
        !event.detail?.markers ||
        event.detail?.cloud ||
        (event.detail?.id && event.detail.id !== id)
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(sync, 250);
    };
    const refresh = () => {
      if (!document.hidden) void sync();
    };
    void sync();
    const interval = setInterval(refresh, 30000);
    window.addEventListener(READER_EVENT, changed);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener(READER_EVENT, changed);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [id, owner, authKnown, key]);
  return error;
}
