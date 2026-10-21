import { useMarkerSync } from './use-marker-sync';
import { useEffect, useState } from 'react';
import { getReadingState, loadCollection, READER_EVENT } from './storage';

export function useReadingState(id) {
  const syncError = useMarkerSync(id);
  const [value, setValue] = useState(() => getReadingState(id));
  useEffect(() => {
    const update = () => setValue(getReadingState(id));
    update();
    window.addEventListener(READER_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(READER_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, [id]);
  return { ...value, syncError };
}
export function useChapters(id) {
  const [value, setValue] = useState({ items: [], loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setValue({ items: [], loading: true, error: '' });
    loadCollection(id).then(
      (items) => {
        if (active) setValue({ items, loading: false, error: '' });
      },
      (error) => {
        if (active) setValue({ items: [], loading: false, error: error.message });
      },
    );
    return () => {
      active = false;
    };
  }, [id, revision]);
  return {
    ...value,
    refresh: () => setRevision((n) => n + 1),
    setItems: (items) => setValue({ items, loading: false, error: '' }),
  };
}
