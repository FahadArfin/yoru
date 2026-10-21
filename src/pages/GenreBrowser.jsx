import React, { useState } from 'react';
import { Link } from '../collection-router';
import { useResource } from '../state';
import { ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';

export default function GenreBrowser({ category, shelves }) {
  const { data, error, refresh } = useResource('/api/catalog/genres');
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const tags = data?.items || shelves.map((name) => ({ name, count: null }));
  const visible = expanded
    ? tags.filter((tag) => tag.name.toLowerCase().includes(search.trim().toLowerCase()))
    : tags.slice(0, 12);
  const shelfId = (name) => `${category}-shelf-${name.toLowerCase().replaceAll(' ', '-')}`;
  return (
    <section className="genre-browser" aria-label="Browse all genres and themes">
      <div className="genre-browser-heading">
        <span>{data ? `${tags.length} genres & themes` : 'Genres & themes'}</span>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`${category}-genre-options`}
          onClick={() => {
            setExpanded(!expanded);
            setSearch('');
          }}
        >
          {expanded ? 'Show fewer genres' : 'Show all genres'}{' '}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {expanded && (
        <label className="genre-browser-search">
          Find a genre or theme
          <input
            type="search"
            placeholder="Try mythology, villainess, or school…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      )}
      <nav id={`${category}-genre-options`} className="genre-jump-list" aria-label="Explore genres">
        {visible.map((tag) => {
          const content = (
            <>
              {tag.name}
              {tag.count !== null && (
                <span className="genre-count">{tag.count.toLocaleString('en-US')}</span>
              )}
            </>
          );
          return shelves.includes(tag.name) ? (
            <a key={tag.name} href={`#${shelfId(tag.name)}`}>
              {content}
            </a>
          ) : (
            <Link key={tag.name} to={`/browse/${category}?genre=${encodeURIComponent(tag.name)}`}>
              {content}
            </Link>
          );
        })}
        {!visible.length && <p role="status">No matching genres or themes.</p>}
        {!search && (
          <a href={`#${shelfId('all')}`}>
            Full collection <ArrowRight size={12} />
          </a>
        )}
      </nav>
      {data && (
        <p className="genre-count-note">
          Most titles first · Source-wide counts across manga formats, including manhwa. Results
          stay in {category}. {data.stale && 'Showing saved counts.'}
        </p>
      )}
      {error && (
        <p className="genre-count-note">
          Showing featured genres. <button onClick={refresh}>Retry all genres</button>
        </p>
      )}
    </section>
  );
}
