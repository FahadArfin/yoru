import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Search, X, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { api, titleOf } from './api';
import CoverImage from './CoverImage';
import './global-search.css';

const filters = [
  ['all', 'All'],
  ['anime', 'Anime'],
  ['manga', 'Manga'],
  ['manhwa', 'Manhwa'],
];
export default function GlobalSearch({ inputRef }) {
  const location = useLocation();
  const navigate = useNavigate();
  const root = useRef();
  const cached = useRef(new Map());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState({ key: '', items: [], loading: false });
  const term = query.trim();
  const key = `${category}:${term.toLowerCase()}`;
  const shown = result.key === key ? result : { items: [], loading: true };
  const expanded = open && term.length >= 2;
  const allUrl = `/browse/${category}?q=${encodeURIComponent(term)}`;
  useEffect(() => {
    setOpen(false);
    setActive(-1);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const outside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => {
    if (!expanded) return;
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
        const data = await api(
          `/api/search/suggestions?${new URLSearchParams({ q: term, category })}`,
          {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          },
        );
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
  }, [key, expanded, retry]);
  useEffect(() => {
    if (active >= 0)
      root.current?.querySelector(`#search-option-${active}`)?.scrollIntoView({ block: 'nearest' });
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
    <form
      ref={root}
      className="global-search"
      role="search"
      onSubmit={submit}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
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
        placeholder="Search your next obsession…"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setRetry(0);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if ((event.ctrlKey || event.metaKey) && event.key === 'k') setOpen(true);
          if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            setActive(-1);
          }
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
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
        <div className="search-panel">
          <div className="search-panel-heading">
            <span>Find your next story</span>
            <Search size={13} />
          </div>
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
          <div className="search-status" role="status">
            {shown.loading ? (
              <>
                <LoaderCircle size={13} className="search-spinner" /> Finding matches…
              </>
            ) : shown.waiting ? (
              'Updating matches…'
            ) : shown.items.length ? (
              `${shown.items.length} matching titles`
            ) : shown.error || shown.providerUnavailable || shown.pending ? (
              'Search is temporarily limited. Try again.'
            ) : (
              `No titles found for “${term}”.`
            )}
          </div>
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
