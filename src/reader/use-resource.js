import { useCallback, useEffect, useState } from 'react';
import { readerRequest } from '../api';
import { useReaderSelection } from '../useCatalogPreferences';
import { readerContextKey } from './requests';

// Mutable room snapshots and exact title details share the same context lifetime.
export function useReaderResource(path, { force = false } = {}) {
  const selection = useReaderSelection();
  const context = selection?.ready ? selection.context : null;
  const key = context && path ? `${readerContextKey(context)}:${path}` : '';
  const [snapshot, setSnapshot] = useState({ key: '', data: null, loading: false, error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (!key) return () => controller.abort();
    setSnapshot({ key, data: null, loading: true, error: '' });
    readerRequest(path, { ...context, signal: controller.signal, force: force || revision > 0 })
      .then((data) => {
        if (!controller.signal.aborted) setSnapshot({ key, data, loading: false, error: '' });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setSnapshot({ key, data: null, loading: false, error: error.message });
      });
    return () => controller.abort();
  }, [key, force, revision]);
  const current = snapshot.key === key ? snapshot : null;
  const setData = useCallback(
    (value) =>
      setSnapshot((old) => {
        if (!key || old.key !== key) return old;
        return { ...old, data: typeof value === 'function' ? value(old.data) : value };
      }),
    [key],
  );
  return {
    data: key ? current?.data : null,
    setData,
    context,
    loading: !!path && !selection?.error && (!key || !current || current.loading),
    error: selection?.error || current?.error || '',
    refresh: useCallback(() => {
      if (!context) void selection?.refresh();
      setRevision((n) => n + 1);
    }, [!!context, selection?.refresh]),
  };
}
