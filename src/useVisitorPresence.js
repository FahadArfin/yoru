import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './api';

export default function useVisitorPresence(userId) {
  const { pathname } = useLocation();
  const activity = pathname.startsWith('/watch/')
    ? 'watching'
    : pathname.startsWith('/read/')
      ? 'reading'
      : 'browsing';
  const [state, setState] = useState({ data: null, connected: false });
  useEffect(() => {
    let alive = true,
      timer,
      controller;
    const update = async () => {
      clearTimeout(timer);
      controller?.abort();
      if (document.visibilityState === 'hidden') return;
      controller = new AbortController();
      const request = controller;
      const timeout = setTimeout(() => request.abort(), 12000);
      try {
        const data = await api('/api/presence', {
          method: 'POST',
          body: JSON.stringify({ activity }),
          signal: request.signal,
        });
        if (alive && request === controller) setState({ data, connected: true });
      } catch {
        if (alive && request === controller) setState((old) => ({ ...old, connected: false }));
      } finally {
        clearTimeout(timeout);
        if (alive && request === controller) timer = setTimeout(update, 25000);
      }
    };
    // Delay one tick so React's development mount check cannot create duplicate guest cookies.
    timer = setTimeout(update, 0);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    return () => {
      alive = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
    };
  }, [activity, userId]);
  return state;
}
