import React, { useEffect, useState } from 'react';
import { useResource } from '../state';
import { useReaderSelection } from '../useCatalogPreferences';
import ReaderCatalog from '../reader/ReaderCatalog';
import { useCollection } from '../collection-context';
import { CoreHomeDiscovery } from './HomeDiscovery';

export function useMangaFeed(mode, period = 'all', category = 'manga') {
  const scope = useCollection();
  const selection = useReaderSelection();
  const coreAllowed =
    !scope?.active ||
    category === 'anime' ||
    (selection?.ready && selection.context.integrationMode !== 'extensions');
  const animeNew = category === 'anime' && mode === 'new';
  const resource = useResource(
    !mode || !coreAllowed
      ? null
      : animeNew
        ? '/api/catalog?category=ANIME&sort=newest&page=1&limit=24'
        : `/api/${category === 'anime' ? 'home' : category}/discovery?mode=${mode}&period=${period}`,
  );
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!mode) return;
    const timer = setInterval(() => {
      if (!document.hidden) resource.refresh();
    }, 120000);
    return () => clearInterval(timer);
  }, [mode, resource.refresh]);
  useEffect(() => {
    setTimedOut(false);
    if (!mode || resource.data?.state !== 'pending') return;
    const timer = setInterval(() => {
      if (!document.hidden) resource.refresh();
    }, 1500);
    const timeout = setTimeout(() => {
      clearInterval(timer);
      setTimedOut(true);
    }, 15000);
    return () => {
      clearInterval(timer);
      clearTimeout(timeout);
    };
  }, [mode, period, resource.data?.state, resource.refresh]);
  const data =
    animeNew && resource.data && !resource.data.mode
      ? {
          ...resource.data,
          mode: 'new',
          period: 'all',
          state:
            resource.data.catalogState === 'fallback' || resource.data.catalogState === 'stale'
              ? 'stale'
              : 'ready',
          caption: 'Newest series by premiere date',
        }
      : resource.data;
  return { ...resource, data, timedOut };
}

export default function MangaDiscovery(props) {
  const scope = useCollection();
  const selection = useReaderSelection();
  const reading = props.category !== 'anime';
  const coreAllowed =
    !scope?.active ||
    !reading ||
    (selection?.ready && selection.context.integrationMode !== 'extensions');
  return (
    <>
      {reading && scope?.active && (
        <ReaderCatalog category={props.category} catalog={props.readerCatalog} discovery />
      )}
      {coreAllowed && <CoreHomeDiscovery category={props.category} newSeries />}
    </>
  );
}
