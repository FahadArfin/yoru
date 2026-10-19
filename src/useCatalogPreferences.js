import { useEffect, useRef, useState } from 'react';
import { useApp } from './state';
import { invalidateApi } from './api';
import {
  CATALOG_PREFERENCES_EVENT,
  loadCatalogPreferences,
  saveCatalogPreference,
  resetCatalogPreferences,
} from './reader/catalog-preferences';
export default function useCatalogPreferences() {
  const { user, authLoading, authKnown } = useApp();
  const scope = authLoading || !authKnown ? null : user?.id || 'guest';
  const [snapshot, setSnapshot] = useState({ scope: null, overrides: {} });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const seen = useRef('');
  const activeScope = useRef(scope);
  activeScope.current = scope;
  useEffect(() => {
    let active = true;
    setSaving(false);
    setError('');
    const update = async (force = false) => {
      if (!scope) return;
      try {
        const overrides = await loadCatalogPreferences(scope, force);
        if (active) {
          const signature = `${scope}:${JSON.stringify(overrides)}`;
          if (seen.current !== signature) {
            if (seen.current) invalidateApi('/api/media/');
            seen.current = signature;
            setRevision((n) => n + 1);
          }
          setSnapshot({ scope, overrides });
          setError('');
        }
      } catch (e) {
        if (active) setError(e.message);
      }
    };
    const event = (e) => {
      if (!e.detail || e.detail === scope) void update();
    };
    const refresh = () => {
      if (!document.hidden) void update(true);
    };
    void update();
    window.addEventListener(CATALOG_PREFERENCES_EVENT, event);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener(CATALOG_PREFERENCES_EVENT, event);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [scope]);
  const mutate = async (job) => {
    if (saving || !scope) return;
    setSaving(true);
    try {
      const overrides = await job();
      if (activeScope.current !== scope) return;
      setSnapshot({ scope, overrides });
      setError('');
    } catch (e) {
      if (activeScope.current === scope) setError(e.message);
    } finally {
      if (activeScope.current === scope) setSaving(false);
    }
  };
  return {
    scope,
    overrides: snapshot.scope === scope ? snapshot.overrides : {},
    ready: !authLoading && (!authKnown || (!!scope && snapshot.scope === scope)),
    saving,
    error,
    revision,
    change: (provider, destination, enabled) =>
      mutate(() => saveCatalogPreference(scope, provider, destination, enabled)),
    reset: () => mutate(() => resetCatalogPreferences(scope)),
  };
}
