import { useCallback, useEffect, useRef, useState } from 'react';
import { readerRequest } from '../api';
import { useReaderSelection } from '../useCatalogPreferences';
import { readerContextKey, canRetainReaderContext } from './requests';

// Only the shared controller can attest a pending browse-only transition.
// This key is for already prepared display state, never network/cache authority.
export function useReaderContinuity() {
  const selection = useReaderSelection();
  const context = selection?.ready ? selection.context : null;
  const pending = selection?.pendingTransition;
  const displayContext = context || pending?.previousContext || null;
  const retained = useRef(null);
  if (!displayContext) retained.current = null;
  else {
    const previous = retained.current;
    const keep =
      previous && canRetainReaderContext(previous.context, displayContext, previous.pending);
    retained.current = {
      context: displayContext,
      key: keep ? previous.key : readerContextKey(displayContext),
      pending: pending || null,
    };
  }
  return { context, displayContext, key: retained.current?.key || '' };
}

// Mutable room snapshots and exact title details share the same context lifetime.
export function useReaderResource(path, { force = false, retainPrepared = false } = {}) {
  const selection = useReaderSelection();
  const context = selection?.ready ? selection.context : null;
  const continuity = useReaderContinuity();
  const prepared = useRef(null);
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
          setSnapshot({
            key,
            data: null,
            loading: false,
            error: error.message,
            status: error.status,
          });
      });
    return () => controller.abort();
  }, [key, force, revision]);
  const current = snapshot.key === key ? snapshot : null;
  const displayKey = retainPrepared && path && continuity.key ? `${continuity.key}:${path}` : '';
  if (!displayKey || [400, 401, 403, 404, 409].includes(current?.status)) prepared.current = null;
  else if (current?.data) prepared.current = { key: displayKey, data: current.data };
  const data =
    current?.data || (prepared.current?.key === displayKey ? prepared.current.data : null);
  const setData = useCallback(
    (value) =>
      setSnapshot((old) => {
        if (!key || old.key !== key) return old;
        return { ...old, data: typeof value === 'function' ? value(old.data) : value };
      }),
    [key],
  );
  return {
    data: retainPrepared ? data : key ? current?.data : null,
    displayKey,
    setData,
    context,
    loading: !!path && !selection?.error && (!key || !current || current.loading),
    error: selection?.error || (retainPrepared && data ? '' : current?.error) || '',
    refresh: useCallback(() => {
      if (!context) void selection?.refresh();
      setRevision((n) => n + 1);
    }, [!!context, selection?.refresh]),
  };
}
