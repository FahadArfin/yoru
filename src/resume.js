import { useCallback, useEffect, useRef, useState } from 'react';
import { api, coverOf, kindOf, titleOf } from './api';
import { parseMediaReference } from '../shared/media-reference.js';
import { visibleAccountHistory } from '../shared/reading-account-view.js';
import { accountPageUrl, createAccountPager } from './account-pages.js';
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
  { context, ready = true, viewKey = '', readinessKey = viewKey, currentSources = [] } = {},
) {
  const destination = context?.destination || 'yoru';
  const projectVisible = (state) =>
    visibleAccountHistory(state.items, context, {
      currentSources,
      authoritativeIds: owner ? state.authorized : undefined,
      limit: Math.max(100, state.page?.items.length || 0),
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
          readinessKey,
          items: projectVisible(state),
          ready: state.loaded,
          page: state.page,
          hasStoredNativeHistory: state.items.some(
            (item) => parseMediaReference(item.mediaId)?.kind === 'extension-manga',
          ),
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
          publish();
        }
      } catch {
        /* Keep this account's pending progress for reconnect/retry. */
      } finally {
        state.busy = false;
      }
    };
    state.flush = flush;
    const pager = createAccountPager({
      request: (task, signal) => api(accountPageUrl('/api/resume', destination, task), { signal }),
      publish: (page) => {
        state.authorized = new Set(page.items.map((item) => item.mediaId));
        state.items = merge(state.items, [...page.items, ...Object.values(state.pending)]);
        state.loaded = page.ready;
        state.page = page;
        publish();
      },
    });
    state.loadMore = () => pager.loadMore();
    const refresh = async () => {
      if (!owner) {
        publish();
        return;
      }
      await flush();
      if (state.active) await pager.refresh();
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
      pager.stop();
      clearTimeout(state.timer);
      clearInterval(interval);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [owner, authKnown, destination, viewKey, readinessKey, ready]);
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
        readinessKey,
        items: projectVisible(state),
        ready: state.loaded,
        page: state.page,
        hasStoredNativeHistory: state.items.some(
          (item) => parseMediaReference(item.mediaId)?.kind === 'extension-manga',
        ),
      });
      clearTimeout(state.timer);
      state.timer = setTimeout(state.flush, 500);
    },
    [owner, authKnown, destination, viewKey, readinessKey, ready],
  );
  const current =
    ready &&
    authKnown &&
    snapshot.owner === owner &&
    snapshot.destination === destination &&
    snapshot.viewKey === viewKey;
  const loadMoreResume = useCallback(() => {
    const state = session.current;
    if (
      state?.active &&
      state.owner === owner &&
      state.destination === destination &&
      state.viewKey === viewKey &&
      ready &&
      authKnown
    )
      return state.loadMore?.();
  }, [owner, destination, viewKey, ready, authKnown]);
  return {
    resumePage: current ? snapshot.page || {} : {},
    resumeHasStoredNativeHistory: current && snapshot.hasStoredNativeHistory,
    loadMoreResume,
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
      // Inventory generations narrow visible history independently of whether
      // this owner/destination/fingerprint/confirmation scope was initialized.
      snapshot.readinessKey === readinessKey &&
      snapshot.ready,
    saveResume,
  };
}
