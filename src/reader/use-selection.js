import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api, syncGuestReaderContext } from '../api.js';
import {
  READER_SELECTION_ACTION_EVENT,
  loadReaderSettings,
  saveIntegrationMode,
} from './catalog-preferences.js';
import { createReaderSelection } from './selection.js';

/** Called once by AppProvider; consumers read that same controller through useReaderSelection. */
export function useReaderSelectionState({ scope, destination, enabled }) {
  const controller = useMemo(
    () =>
      createReaderSelection({
        loadSettings: loadReaderSettings,
        saveMode: saveIntegrationMode,
        syncGuest: syncGuestReaderContext,
        readContext: (target, signal, owner) =>
          api(`/api/reader/context?destination=${encodeURIComponent(target)}`, {
            signal,
            credentials: owner === null ? 'omit' : 'same-origin',
          }),
      }),
    [],
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    void controller.select({ scope, destination, enabled });
    const changed = (event) => {
      if (event.detail?.scope === scope)
        void controller.preferencesChanged(event.detail.destination);
    };
    const refresh = () => {
      if (!document.hidden) void controller.refresh();
    };
    window.addEventListener(READER_SELECTION_ACTION_EVENT, changed);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      controller.dispose();
      clearInterval(timer);
      window.removeEventListener(READER_SELECTION_ACTION_EVENT, changed);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [controller, scope, destination, enabled]);
  const current =
    enabled && snapshot.context?.owner === scope && snapshot.context.destination === destination;
  return useMemo(
    () => ({
      context: current ? snapshot.context : null,
      ready: Boolean(current && snapshot.ready),
      error: snapshot.error,
      setIntegrationMode: controller.setIntegrationMode,
      refresh: controller.refresh,
    }),
    [controller, current, snapshot],
  );
}
