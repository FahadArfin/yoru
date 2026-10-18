import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, cachedApi, invalidateScopedApi, peek, send, itemsOf } from './api';
import { connectEvents } from './realtime';
import useVisitorPresence from './useVisitorPresence';
import { useResume } from './resume';
import { setReaderAccount } from './reader/storage';
const Context = createContext(null);
export function useApp() {
  return useContext(Context);
}
export function useResource(path, cache = true) {
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
  const [user, setUserState] = useState(null);
  const visitors = useVisitorPresence(user?.id);
  const [authKnown, setAuthKnown] = useState(false);
  const setUser = useCallback((value) => {
    invalidateScopedApi();
    setReaderAccount(value?.id);
    setUserState(value);
    setAuthKnown(true);
  }, []);
  const resume = useResume(user?.id, authKnown);
  const [authLoading, setAuthLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [config, setConfig] = useState({});
  const [library, setLibrary] = useState([]);
  const [online, setOnline] = useState({ count: 0, users: [] });
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();
  const [event, setEvent] = useState(null);
  const activeUser = useRef(null);
  const libraryRequest = useRef(0);
  activeUser.current = user?.id;
  const notify = useCallback((text, type = 'success') => {
    clearTimeout(toastTimer.current);
    setToast({ text, type });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  const refreshLibrary = useCallback(async () => {
    const requestId = ++libraryRequest.current;
    const requestedUser = activeUser.current;
    if (!requestedUser) {
      setLibrary([]);
      return;
    }
    try {
      const data = await api('/api/library');
      if (activeUser.current === requestedUser && libraryRequest.current === requestId)
        setLibrary(itemsOf(data));
    } catch {
      if (activeUser.current === requestedUser && libraryRequest.current === requestId)
        setLibrary([]);
    }
  }, []);
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
        await send(`/api/library/${encodeURIComponent(media.id)}`, patch, 'PUT');
        await refreshLibrary();
        notify('Saved to your library');
        return true;
      } catch (e) {
        notify(e.message, 'error');
        return false;
      }
    },
    [requireUser, refreshLibrary, notify],
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
