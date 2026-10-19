import { useCallback, useEffect, useRef, useState } from 'react';
import { api, coverOf, kindOf, titleOf } from './api';
import { visibleAccountHistory } from '../shared/reading-account-view.js';
import { saveReadingState } from './reader/storage';

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
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function useResume(
  owner,
  authKnown,
  { context, ready = true, viewKey = '', currentSources = [] } = {},
) {
  const destination = context?.destination || 'yoru';
  const projectVisible = (state) =>
    visibleAccountHistory(state.items, context, {
      currentSources,
      authoritativeIds: owner ? state.authorized : undefined,
    });
  const [snapshot, setSnapshot] = useState({ owner: undefined, items: [], ready: false });
  const session = useRef(null);
  useEffect(() => {
    if (!authKnown || !ready) return;
    const state = {
      owner,
      destination,
      viewKey,
      ...read(owner),
      authorized: new Set(),
      loaded: !owner,
      active: true,
      busy: false,
      timer: null,
    };
    session.current = state;
    const publish = () => {
      persist(owner, { items: state.items, pending: state.pending });
      if (state.active)
        setSnapshot({
          owner,
          destination,
          viewKey,
          items: projectVisible(state),
          ready: state.loaded,
        });
    };
    const flush = async () => {
      if (!owner || !state.active || state.busy) return;
      state.busy = true;
      try {
        for (const item of Object.values(state.pending)) {
          if (!state.active) break;
          if ((item.destination || 'yoru') !== destination) continue;
          const result = await api(
            `/api/resume/${encodeURIComponent(item.mediaId)}?destination=${encodeURIComponent(destination)}`,
            {
              method: 'PUT',
              body: JSON.stringify({ ...item, owner }),
              keepalive: true,
              signal: AbortSignal.timeout(15000),
            },
          );
          if (!state.active) break;
          if ((item.destination || 'yoru') !== destination) continue;
          if (state.pending[item.mediaId]?.updatedAt === item.updatedAt)
            delete state.pending[item.mediaId];
          state.items = merge(state.items, [result.item]);
          state.authorized.add(result.item.mediaId);
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
        const result = await api(`/api/resume?destination=${encodeURIComponent(destination)}`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!state.active) return;
        state.authorized = new Set((result.items || []).map((item) => item.mediaId));
        state.items = merge(state.items, [
          ...(result.items || []),
          ...Object.values(state.pending),
        ]);
      } catch {
        /* The account-scoped cache remains available offline. */
      }
      state.loaded = true;
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
  }, [owner, authKnown, destination, viewKey, ready]);
  const saveResume = useCallback(
    (media, patch) => {
      const state = session.current;
      if (
        !state?.active ||
        state.owner !== owner ||
        state.destination !== destination ||
        state.viewKey !== viewKey ||
        !authKnown ||
        !ready
      )
        return;
      const item = {
        mediaId: media.id,
        destination,
        mediaSnapshot: media,
        sourceRef: media.sourceRef,
        classification: media.classification,
        provenance: media.provenance,
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
      try {
        if (media.category !== 'ANIME')
          saveReadingState(media.id, { mediaSnapshot: media, destination });
      } catch {}
      if (owner) state.pending[item.mediaId] = item;
      persist(owner, { items: state.items, pending: state.pending });
      setSnapshot({
        owner,
        destination,
        viewKey,
        items: projectVisible(state),
        ready: state.loaded,
      });
      clearTimeout(state.timer);
      state.timer = setTimeout(state.flush, 500);
    },
    [owner, authKnown, destination, viewKey, ready],
  );
  return {
    resumeItems:
      ready &&
      snapshot.owner === owner &&
      snapshot.destination === destination &&
      snapshot.viewKey === viewKey
        ? snapshot.items
        : [],
    resumeReady:
      ready &&
      authKnown &&
      snapshot.owner === owner &&
      snapshot.destination === destination &&
      snapshot.viewKey === viewKey &&
      snapshot.ready,
    saveResume,
  };
}
