import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useRef,
  useState,
} from 'react';
import { api, cachedApi, invalidateScopedApi, peek, send, itemsOf } from './api';
import { connectEvents } from './realtime';
import useVisitorPresence from './useVisitorPresence';
import { useResume } from './resume';
import { setReaderAccount } from './reader/storage';
import { useCollection } from './collection-context';
import { collectionRequest, collectionView } from '../shared/collection-view';
import { useLocation } from 'react-router-dom';
import { confirmationKey } from './nsfw';
import { CATALOG_PREFERENCES_EVENT, loadReaderSettings } from './reader/catalog-preferences';
const Context = createContext(null);
export function useApp() {
  const app = useContext(Context);
  return app;
}
export function useResource(path, cache = true) {
  const scope = useCollection();
  const request = collectionRequest(path, scope?.active);
  const result = useRawResource(request, cache);
  const data = useMemo(
    () => (scope?.active ? collectionView(path, result.data, scope.catalog) : result.data),
    [path, result.data, scope?.active, scope?.catalog],
  );
  return {
    ...result,
    data,
    loading: result.loading || Boolean(path && scope?.active && scope.loading),
    error: (request ? result.error : '') || (scope?.active ? scope.error : ''),
    refresh: request ? result.refresh : scope?.refresh || result.refresh,
  };
}
export function useRawResource(path, cache = true) {
  const [loadedPath, setLoadedPath] = useState(path);
  const [data, setData] = useState(() => (path && cache ? peek(path) : null));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(path && !(cache && peek(path))));
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setLoadedPath(path);
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    let alive = true;
    const existing = cache && peek(path);
    setData(existing || null);
    setLoading(!existing);
    setError('');
    (cache ? cachedApi(path, revision > 0) : api(path))
      .then((value) => {
        if (alive) setData(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, cache, revision]);
  return {
    data: loadedPath === path ? data : path && cache ? peek(path) : null,
    setData,
    error: loadedPath === path ? error : '',
    loading: loadedPath === path ? loading : Boolean(path && !(cache && peek(path))),
    refresh: useCallback(() => setRevision((v) => v + 1), []),
  };
}
export function AppProvider({ children }) {
  const { pathname } = useLocation();
  const destination = /^\/ara-ara(?:\/|$)/.test(pathname) ? 'ara-ara' : 'yoru';
  const [confirmation, setConfirmation] = useState(false);
  const [preferenceVersion, setPreferenceVersion] = useState(0);
  useEffect(() => {
    const confirm = (e) => setConfirmation(Boolean(e.detail?.confirmed));
    const preferences = () => setPreferenceVersion((v) => v + 1);
    window.addEventListener('ara-confirmation', confirm);
    window.addEventListener(CATALOG_PREFERENCES_EVENT, preferences);
    return () => {
      window.removeEventListener('ara-confirmation', confirm);
      window.removeEventListener(CATALOG_PREFERENCES_EVENT, preferences);
    };
  }, []);
  let confirmed = confirmation;
  try {
    confirmed = confirmed || sessionStorage.getItem(confirmationKey) === '1';
  } catch {}
  const contentAllowed = destination === 'yoru' || confirmed;
  const [user, setUserState] = useState(null);
  const visitors = useVisitorPresence(user?.id);
  const [authKnown, setAuthKnown] = useState(false);
  const setUser = useCallback((value) => {
    invalidateScopedApi();
    setReaderAccount(value?.id);
    setUserState(value);
    setAuthKnown(true);
  }, []);
  const accountScope = user?.id || 'guest';
  const [readerPolicy, setReaderPolicy] = useState(null);
  useEffect(() => {
    if (!authKnown) return;
    let active = true;
    loadReaderSettings(accountScope)
      .then((settings) => {
        if (active) setReaderPolicy({ owner: accountScope, version: preferenceVersion, settings });
      })
      .catch(() => {
        if (active) setReaderPolicy(null);
      });
    return () => {
      active = false;
    };
  }, [accountScope, authKnown, preferenceVersion]);
  const policyReady =
    contentAllowed &&
    authKnown &&
    readerPolicy?.owner === accountScope &&
    readerPolicy.version === preferenceVersion;
  const [sourceInventory, setSourceInventory] = useState({ key: null, sources: [] });
  const [inventoryRefresh, setInventoryRefresh] = useState(0);
  const viewKey = `${accountScope}:${destination}:${preferenceVersion}:${readerPolicy?.settings?.revision ?? 0}:${contentAllowed}`;
  useEffect(() => {
    if (!policyReady || user) return;
    let active = true;
    const controller = new AbortController();
    (async () => {
      const sources = [];
      let cursor = null;
      const deadline = Date.now() + 12000;
      for (let i = 0; i < 4 && Date.now() < deadline; i++) {
        const result = await api(
          `/api/reader/catalogs?destination=${destination}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(Math.max(1, deadline - Date.now())),
            ]),
          },
        );
        if (!active) return;
        sources.push(...(result.sources || []));
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      if (active) setSourceInventory({ key: viewKey, sources, observedAt: Date.now() });
    })().catch(() => {
      if (active) setSourceInventory({ key: viewKey, sources: [], observedAt: Date.now() });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [policyReady, user, viewKey, destination, inventoryRefresh]);
  useEffect(() => {
    if (!policyReady || user) return;
    const refresh = () => {
      if (!document.hidden) setInventoryRefresh((v) => v + 1);
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [policyReady, user]);
  const readingContext = useMemo(
    () => ({
      destination,
      extensionsEnabled: true,
      overrides: readerPolicy?.settings?.overrides || {},
      integrationMode: readerPolicy?.settings?.modes?.[destination] || 'all',
    }),
    [destination, readerPolicy],
  );
  const inventoryFresh =
    sourceInventory.key === viewKey && Date.now() - (sourceInventory.observedAt || 0) < 60000;
  const currentSources = inventoryFresh ? sourceInventory.sources : [];
  const resume = useResume(user?.id, authKnown, {
    context: readingContext,
    ready: policyReady,
    viewKey: `${viewKey}:${inventoryFresh ? sourceInventory.observedAt : 0}`,
    currentSources,
  });
  const [authLoading, setAuthLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [config, setConfig] = useState({});
  const [librarySnapshot, setLibrarySnapshot] = useState({ key: null, items: [] });
  const library = policyReady && librarySnapshot.key === viewKey ? librarySnapshot.items : [];
  const setLibrary = (items) => setLibrarySnapshot({ key: viewKey, items });
  const [online, setOnline] = useState({ count: 0, users: [] });
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();
  const [event, setEvent] = useState(null);
  const activeUser = useRef(null);
  const libraryRequest = useRef(0);
  const activeView = useRef(viewKey);
  activeView.current = viewKey;
  activeUser.current = user?.id;
  const notify = useCallback((text, type = 'success') => {
    clearTimeout(toastTimer.current);
    setToast({ text, type });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  const refreshLibrary = useCallback(async () => {
    const requestId = ++libraryRequest.current;
    const requestedUser = activeUser.current;
    const requestedView = viewKey;
    if (!requestedUser || !policyReady) {
      setLibrary([]);
      return;
    }
    try {
      const data = await api(`/api/library?destination=${destination}`);
      if (
        activeUser.current === requestedUser &&
        activeView.current === requestedView &&
        libraryRequest.current === requestId
      )
        setLibrary(itemsOf(data));
    } catch {
      if (
        activeUser.current === requestedUser &&
        activeView.current === requestedView &&
        libraryRequest.current === requestId
      )
        setLibrary([]);
    }
  }, [viewKey, policyReady, destination]);
  useEffect(() => {
    api('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => {})
      .finally(() => setAuthLoading(false));
    let active = true,
      timer;
    const controller = new AbortController();
    const loadConfig = async () => {
      try {
        const value = await api('/api/config', { signal: controller.signal });
        if (active) setConfig(value);
      } catch {
        if (active) timer = setTimeout(loadConfig, 3000);
      }
    };
    loadConfig();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  useEffect(() => {
    if (user) refreshLibrary();
    else setLibrary([]);
  }, [user, refreshLibrary]);
  useEffect(() => {
    if (!user || !policyReady) return;
    const refresh = () => {
      if (!document.hidden) void refreshLibrary();
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [user, policyReady, refreshLibrary]);
  useEffect(() => {
    if (!config.realtime?.transport) return;
    let active = true;
    const handle = (e) => {
      if (!active) return;
      try {
        const payload = JSON.parse(e.data);
        setEvent({ type: e.type, data: payload, time: Date.now() });
        const presence = e.type === 'online' ? payload : payload.online;
        if (presence !== undefined)
          setOnline(
            typeof presence === 'number'
              ? { count: presence, users: [] }
              : Array.isArray(presence)
                ? { count: presence.length, users: presence }
                : presence,
          );
      } catch {
        /* reconnect will bring the next snapshot */
      }
    };
    const stream = connectEvents({
      transport: config.realtime.transport,
      onEvent: handle,
      onOpen: () => setConnected(true),
      onError: () => setConnected(false),
      onSession: async (viewerId) => {
        if ((activeUser.current || null) === viewerId) return;
        const data = await api('/api/auth/me');
        if (active) setUser(data.user);
      },
    });
    return () => {
      active = false;
      stream.close();
    };
  }, [user?.id, config.realtime?.transport]);
  useEffect(() => {
    if (event?.type === 'snapshot' || (event?.type === 'library' && event.data.userId === user?.id))
      refreshLibrary();
  }, [event, user?.id, refreshLibrary]);
  const requireUser = useCallback(() => {
    if (user) return true;
    setAuthOpen(true);
    return false;
  }, [user]);
  const updateEntry = useCallback(
    async (media, patch) => {
      if (!requireUser()) return false;
      try {
        if (!policyReady) return false;
        await send(
          `/api/library/${encodeURIComponent(media.id)}?destination=${destination}`,
          patch,
          'PUT',
        );
        await refreshLibrary();
        notify('Saved to your library');
        return true;
      } catch (e) {
        notify(e.message, 'error');
        return false;
      }
    },
    [requireUser, refreshLibrary, notify, policyReady, destination],
  );
  const logout = async () => {
    try {
      await send('/api/auth/logout', {});
      setUser(null);
      notify('Signed out');
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const entryFor = (media) =>
    library.find(
      (item) => String(item.mediaId) === String(typeof media === 'object' ? media.id : media),
    );
  return (
    <Context.Provider
      value={{
        ...resume,
        user,
        setUser,
        authLoading,
        authKnown,
        authOpen,
        setAuthOpen,
        config,
        library,
        readingContext: policyReady ? readingContext : null,
        currentReaderSources: currentSources,
        refreshLibrary,
        entryFor,
        updateEntry,
        online,
        visitors,
        connected,
        event,
        notify,
        toast,
        requireUser,
        logout,
      }}
    >
      {children}
    </Context.Provider>
  );
}
