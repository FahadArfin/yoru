import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from './collection-router';
import { Search, X, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { api, readerRequest, titleOf } from './api';
import { useReaderSelection } from './useCatalogPreferences';
import { readingFeedKey, readingSuggestions } from './reader/feed';
import CoverImage from './CoverImage';
import './global-search.css';

const filters = [
  ['all', 'All'],
  ['anime', 'Anime'],
  ['manga', 'Manga'],
  ['manhwa', 'Manhwa'],
];
export default function GlobalSearch({ inputRef, collection }) {
  const selection = useReaderSelection();
  const readerContext = selection?.ready ? selection.context : null;
  const location = useLocation();
  const navigate = useNavigate();
  const root = useRef();
  const openedAt = useRef({ x: 0, y: 0 });
  const cached = useRef(new Map());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState({ key: '', items: [], loading: false });
  const [panelStyle, setPanelStyle] = useState({});
  const term = query.trim();
  const key = `${readingFeedKey(readerContext, `${category}:${term.toLowerCase()}`)}`;
  const shown = result.key === key ? result : { items: [], loading: true };
  const expanded = open && term.length >= 2;
  const allUrl = `${collection ? '/ara-ara' : '/browse'}/${category}?q=${encodeURIComponent(term)}`;
  const showSuggestions = () => {
    // Ignore a queued scroll event from bringing the search field into view.
    openedAt.current = { x: window.scrollX, y: window.scrollY };
    setOpen(true);
  };
  useEffect(() => {
    setOpen(false);
    setActive(-1);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const scroll = (event) => {
      // Scrolling the results is browsing suggestions, not dismissing them.
      if (root.current?.contains(event.target)) return;
      if (
        event.target === document &&
        window.scrollX === openedAt.current.x &&
        window.scrollY === openedAt.current.y
      )
        return;
      setOpen(false);
      setActive(-1);
    };
    document.addEventListener('scroll', scroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', scroll, true);
  }, []);
  useLayoutEffect(() => {
    if (!expanded || !root.current) return;
    const align = () => {
      const bounds = root.current.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth;
      const width = Math.min(
        viewport <= 760 ? bounds.width : Math.max(bounds.width, 320),
        viewport - 24,
      );
      const left = Math.max(12, Math.min(bounds.left, viewport - width - 12)) - bounds.left;
      setPanelStyle({ width, left });
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(root.current);
    window.addEventListener('resize', align);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', align);
    };
  }, [expanded]);
  useEffect(() => {
    if (!expanded || !readerContext || (collection && !collection.confirmed)) return;
    const controller = new AbortController();
    let timer;
    const saved = cached.current.get(key);
    if (saved && Date.now() - saved.time < 60000 && !retry) {
      setResult({ key, ...saved.data, loading: false });
      return;
    }
    setResult({ key, items: [], loading: true });
    const load = async (attempt = 0) => {
      try {
        const coreRequest = collection
          ? {
              items: (collection.catalog?.items || [])
                .filter(
                  (item) =>
                    (category === 'all' || item.category.toLowerCase() === category) &&
                    [item.title, item.titleRomaji, item.titleJapanese].some((title) =>
                      title?.toLowerCase().includes(term.toLowerCase()),
                    ),
                )
                .slice(0, 12),
            }
          : api(`/api/search/suggestions?${new URLSearchParams({ q: term, category })}`, {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
            });
        const nativeRequest =
          category !== 'anime' && readerContext.integrationMode !== 'core'
            ? readerRequest(
                `/api/reader/suggestions?${new URLSearchParams({ q: term, limit: '12' })}`,
                { ...readerContext, signal: controller.signal },
              )
            : Promise.resolve({ items: [] });
        const [core, native] = await Promise.allSettled([coreRequest, nativeRequest]);
        if (
          core.status === 'rejected' &&
          (native.status === 'rejected' || !native.value.items?.length)
        )
          throw core.reason;
        const coreData =
          core.status === 'fulfilled' ? core.value : { items: [], providerUnavailable: true };
        const data = {
          ...coreData,
          providerUnavailable: Boolean(
            coreData.providerUnavailable || native.status === 'rejected',
          ),
          items: readingSuggestions(
            [
              ...(coreData.items || []),
              ...(native.status === 'fulfilled' ? native.value.items || [] : []),
            ],
            readerContext,
            category,
          ),
        };
        if (controller.signal.aborted) return;
        setResult({ key, ...data, loading: false, waiting: data.pending && attempt < 5 });
        if (data.pending && attempt < 5) timer = setTimeout(() => load(attempt + 1), 1800);
        else if (!data.pending && !data.providerUnavailable) {
          cached.current.set(key, { time: Date.now(), data });
          if (cached.current.size > 40) cached.current.delete(cached.current.keys().next().value);
        }
      } catch {
        if (!controller.signal.aborted)
          setResult((old) => ({ ...old, key, loading: false, waiting: false, error: true }));
      }
    };
    timer = setTimeout(() => load(), 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, expanded, retry, collection?.confirmed, collection?.catalog]);
  useEffect(() => {
    const option = root.current?.querySelector(`#search-option-${active}`);
    const list = root.current?.querySelector('.search-results');
    if (!option || !list) return;
    const itemBounds = option.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    if (itemBounds.top < listBounds.top) list.scrollTop += itemBounds.top - listBounds.top;
    else if (itemBounds.bottom > listBounds.bottom)
      list.scrollTop += itemBounds.bottom - listBounds.bottom;
  }, [active]);
  const submit = (event) => {
    event.preventDefault();
    if (!term) return;
    navigate(
      expanded && active >= 0 && shown.items[active] ? `/title/${shown.items[active].id}` : allUrl,
    );
    setOpen(false);
    inputRef.current?.blur();
  };
  return (
    <form ref={root} className="global-search" role="search" onSubmit={submit}>
      <Search size={18} aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        maxLength={150}
        autoComplete="off"
        spellCheck="false"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? 'search-suggestions' : undefined}
        aria-activedescendant={
          expanded && active >= 0 && shown.items[active] ? `search-option-${active}` : undefined
        }
        aria-label="Search anime, manga, and manhwa"
        disabled={!selection?.ready || Boolean(collection && !collection.confirmed)}
        placeholder="Search your next obsession…"
        onFocus={showSuggestions}
        onClick={showSuggestions}
        onChange={(event) => {
          setQuery(event.target.value);
          showSuggestions();
          setRetry(0);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if ((event.ctrlKey || event.metaKey) && event.key === 'k') showSuggestions();
          if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            setActive(-1);
          }
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            showSuggestions();
            if (shown.items.length)
              setActive((old) =>
                event.key === 'ArrowDown'
                  ? (old + 1) % shown.items.length
                  : old <= 0
                    ? shown.items.length - 1
                    : old - 1,
              );
          }
        }}
      />
      {query ? (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onClick={() => {
            setQuery('');
            inputRef.current?.focus();
          }}
        >
          <X size={14} />
        </button>
      ) : (
        <kbd>Ctrl K</kbd>
      )}
      {expanded && (
        <div className="search-panel" style={panelStyle}>
          <div className="search-filters" aria-label="Search categories">
            {filters.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                onClick={() => {
                  setCategory(value);
                  setRetry(0);
                  setActive(-1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {(!shown.items.length ||
            shown.loading ||
            shown.waiting ||
            shown.error ||
            shown.providerUnavailable) && (
            <div className="search-status" role="status">
              {shown.loading ? (
                <>
                  <LoaderCircle size={13} className="search-spinner" /> Finding matches…
                </>
              ) : shown.waiting ? (
                'Updating matches…'
              ) : shown.error || shown.providerUnavailable || shown.pending ? (
                'Search is temporarily limited. Try again.'
              ) : (
                `No titles found for “${term}”.`
              )}
            </div>
          )}
          <div
            className="search-results"
            id="search-suggestions"
            role="listbox"
            aria-label="Suggested titles"
            aria-busy={shown.loading || shown.waiting || false}
          >
            {shown.items.map((item, index) => (
              <Link
                key={item.id}
                id={`search-option-${index}`}
                role="option"
                aria-selected={active === index}
                tabIndex={-1}
                className="search-result"
                to={`/title/${item.id}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => setOpen(false)}
              >
                <CoverImage media={item} alt="" loading="eager" />
                <span className="search-result-copy">
                  <strong>{titleOf(item)}</strong>
                  <span>
                    {item.category?.toLowerCase()}
                    {item.sourceRef?.providerKey && (
                      <>
                        <i>·</i>
                        {item.sourceRef.providerKey}
                      </>
                    )}
                    {item.format && item.format.toUpperCase() !== item.category && (
                      <>
                        <i>·</i>
                        {item.format}
                      </>
                    )}
                    {item.year > 0 && (
                      <>
                        <i>·</i>
                        {item.year}
                      </>
                    )}
                    {item.episodes > 0 && (
                      <>
                        <i>·</i>
                        {item.episodes} ep
                      </>
                    )}
                    {item.category !== 'ANIME' && item.chapters > 0 && (
                      <>
                        <i>·</i>
                        {item.chapters} ch
                      </>
                    )}
                  </span>
                </span>
                <ArrowUpRight size={14} />
              </Link>
            ))}
          </div>
          {(shown.error || shown.providerUnavailable || (shown.pending && !shown.waiting)) && (
            <button
              className="search-retry"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry search
            </button>
          )}
          <Link className="search-view-all" to={allUrl} onClick={() => setOpen(false)}>
            View all results <ArrowUpRight size={14} />
          </Link>
        </div>
      )}
    </form>
  );
}
