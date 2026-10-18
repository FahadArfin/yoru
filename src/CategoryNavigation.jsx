import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from './collection-router';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { browseGenres } from './pages/GenreCollections';
import './category-navigation.css';

export const animeFormats = [
  ['tv', 'TV series'],
  ['movie', 'Movies'],
  ['ova', 'OVAs'],
  ['ona', 'ONAs'],
  ['special', 'Specials'],
];

export default function CategoryNavigation({ category }) {
  const location = useLocation();
  const [open, setOpen] = useState(null);
  const root = useRef(null);
  const triggers = useRef({});
  const params = new URLSearchParams(location.search);
  const destination = (changes = {}) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    next.set('view', 'all');
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return `/browse/${category}?${next}`;
  };
  useEffect(() => setOpen(null), [location.key]);
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const toggle = (name, label) => (
    <button
      ref={(element) => (triggers.current[name] = element)}
      type="button"
      aria-expanded={open === name}
      aria-controls={`category-${name}`}
      onClick={() => setOpen(open === name ? null : name)}
    >
      {label} <ChevronDown size={12} />
    </button>
  );
  return (
    <nav
      key={category}
      ref={root}
      className="category-navigation"
      aria-label={`${category} collections`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          triggers.current[open]?.focus();
          setOpen(null);
        }
      }}
    >
      <div className="category-navigation-row">
        <span className="category-navigation-label">Explore {category}</span>
        {category === 'anime' && toggle('types', 'Types')}
        {toggle('genres', 'Genres')}
        <Link to={destination({ sort: 'score' })}>Top rated</Link>
        <Link to={destination({ sort: 'newest' })}>Newest</Link>
        <Link to={destination({ sort: 'title' })}>A–Z</Link>
        <Link className="category-navigation-all" to={`/browse/${category}?view=all`}>
          Full collection <ArrowUpRight size={12} />
        </Link>
      </div>
      {category === 'anime' && (
        <div
          id="category-types"
          className="category-popover category-types"
          hidden={open !== 'types'}
        >
          <Link
            to={destination({ format: '' })}
            aria-current={!params.get('format') ? 'true' : undefined}
          >
            All types
          </Link>
          {animeFormats.map(([value, label]) => (
            <Link
              key={value}
              to={destination({ format: value })}
              aria-current={params.get('format') === value ? 'true' : undefined}
            >
              {label}
            </Link>
          ))}
        </div>
      )}
      <div
        id="category-genres"
        className="category-popover category-genres"
        hidden={open !== 'genres'}
      >
        <div className="category-popover-heading">
          <span>Find your next {category}</span>
          <Link to={destination({ genre: '' })}>
            All genres <ArrowUpRight size={12} />
          </Link>
        </div>
        <div className="category-genres-grid">
          {[...browseGenres].sort().map((genre) => (
            <Link
              key={genre}
              to={destination({ genre })}
              aria-current={params.get('genre') === genre ? 'true' : undefined}
            >
              <span aria-hidden="true">·</span>
              {genre}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
