import { useCallback, useEffect, useRef, useState } from 'react';
import { api, coverOf, kindOf, titleOf } from './api';

const key = (owner) => `yoru:resume:${owner || 'guest'}`;
function read(owner) {
  try {
    const value = JSON.parse(localStorage.getItem(key(owner)));
    if (Array.isArray(value?.items) && value.pending && typeof value.pending === 'object')
      return value;
    return { items: [], pending: {} };
  } catch {
    return { items: [], pending: {} };
  }
}
function persist(owner, value) {
  try {
    localStorage.setItem(key(owner), JSON.stringify(value));
  } catch {}
}
function merge(items, updates) {
  const map = new Map(items.map((item) => [item.mediaId, item]));
  for (const item of updates)
    if (!map.has(item.mediaId) || item.updatedAt >= map.get(item.mediaId).updatedAt)
      map.set(item.mediaId, item);
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
}

export function useResume(owner, authKnown) {
  const [snapshot, setSnapshot] = useState({ owner: undefined, items: [], ready: false });
  const session = useRef(null);
  useEffect(() => {
    if (!authKnown) return;
    const state = { owner, ...read(owner), active: true, busy: false, timer: null };
    session.current = state;
    const publish = () => {
      persist(owner, { items: state.items, pending: state.pending });
      if (state.active) setSnapshot({ owner, items: state.items, ready: true });
    };
    const flush = async () => {
      if (!owner || !state.active || state.busy) return;
      state.busy = true;
      try {
        for (const item of Object.values(state.pending)) {
          if (!state.active) break;
          const result = await api(`/api/resume/${encodeURIComponent(item.mediaId)}`, {
            method: 'PUT',
            body: JSON.stringify({ ...item, owner }),
            keepalive: true,
            signal: AbortSignal.timeout(15000),
          });
          if (!state.active) break;
          if (state.pending[item.mediaId]?.updatedAt === item.updatedAt)
            delete state.pending[item.mediaId];
          state.items = merge(state.items, [result.item]);
          publish();
        }
      } catch {
        /* Keep this account's pending progress for reconnect/retry. */
      } finally {
        state.busy = false;
      }
    };
    state.flush = flush;
    const refresh = async () => {
      if (!owner) {
        publish();
        return;
      }
      await flush();
      try {
        const result = await api('/api/resume', { signal: AbortSignal.timeout(15000) });
        if (!state.active) return;
        state.items = merge(state.items, [
          ...(result.items || []),
          ...Object.values(state.pending),
        ]);
      } catch {
        /* The account-scoped cache remains available offline. */
      }
      if (state.active) publish();
    };
    const visible = () => {
      if (!document.hidden) void refresh();
      else void flush();
    };
    void refresh();
    const interval = setInterval(refresh, 30000);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visible);
    return () => {
      state.active = false;
      clearTimeout(state.timer);
      clearInterval(interval);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [owner, authKnown]);
  const saveResume = useCallback(
    (media, patch) => {
      const state = session.current;
      if (!state?.active || state.owner !== owner || !authKnown) return;
      const item = {
        mediaId: media.id,
        title: titleOf(media),
        cover: coverOf(media),
        category: kindOf(media),
        ...patch,
        updatedAt: Math.max(
          Date.now(),
          (state.items.find((item) => item.mediaId === media.id)?.updatedAt || 0) + 1,
        ),
      };
      state.items = merge(state.items, [item]);
      if (owner) state.pending[item.mediaId] = item;
      persist(owner, { items: state.items, pending: state.pending });
      setSnapshot({ owner, items: state.items, ready: true });
      clearTimeout(state.timer);
      state.timer = setTimeout(state.flush, 500);
    },
    [owner, authKnown],
  );
  return {
    resumeItems: snapshot.owner === owner ? snapshot.items : [],
    resumeReady: authKnown && snapshot.owner === owner && snapshot.ready,
    saveResume,
  };
}
