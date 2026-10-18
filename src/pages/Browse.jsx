import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from '../collection-router';
import { ArrowLeft, ArrowRight, Search, SlidersHorizontal, X } from 'lucide-react';
import { itemsOf } from '../api';
import { useResource } from '../state';
import { Empty, ErrorNotice, Loading, Poster } from '../components';
import GenreCollections, { browseGenres } from './GenreCollections';
import { animeFormats } from '../CategoryNavigation';
const labels = {
  anime: ['Anime', 'Find a world worth getting lost in.'],
  manga: ['Manga', 'Great stories, one panel at a time.'],
  manhwa: ['Manhwa', 'Your next scroll-stopping obsession.'],
  all: ['Explore everything', 'One universe. Endless ways to escape.'],
};
export default function Browse({ embedded = false, categoryOverride }) {
  const route = useParams();
  const category = categoryOverride || route.category;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [search, setSearch] = useState(q);
  const genre = params.get('genre') || '';
  const format = category === 'anime' ? params.get('format') || '' : '';
  const sort = params.get('sort') || 'trending';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const chosen = labels[category] ? category : 'all';
  const discovery =
    chosen !== 'all' &&
    !['q', 'genre', 'format', 'sort', 'page', 'view'].some((key) => params.get(key));
  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    if (!embedded) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [page, chosen, embedded, discovery, genre, format, q]);
  const query = new URLSearchParams({
    category: chosen.toUpperCase(),
    search: q,
    genre,
    ...(format ? { format } : {}),
    sort,
    page,
    limit: '48',
  });
  const { data, error, loading, refresh } = useResource(discovery ? null : `/api/catalog?${query}`);
  const update = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };
  const collectionControlsBelow = chosen === 'anime' && discovery;
  const filters = (
    <div className="filter-bar" role="region" aria-label="Catalog filters">
      <form
        className="inline-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: search });
        }}
      >
        <Search size={18} />
        <input
          aria-label="Search catalog"
          placeholder={`Search ${chosen === 'all' ? 'all stories' : chosen}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            onClick={() => {
              setSearch('');
              update({ q: '' });
            }}
          >
            <X size={15} />
          </button>
        )}
        <button type="submit" className="search-submit">
          Search
        </button>
      </form>
      <label className="filter-select">
        <select
          aria-label="Catalog type"
          value={chosen}
          onChange={(e) =>
            navigate(`/browse/${e.target.value}${q ? `?q=${encodeURIComponent(q)}` : ''}`)
          }
        >
          {Object.entries(labels).map(([key, value]) => (
            <option key={key} value={key}>
              {value[0]}
            </option>
          ))}
        </select>
      </label>
      {chosen === 'anime' && (
        <label className="filter-select">
          <select
            aria-label="Anime format"
            value={format}
            onChange={(e) => update({ format: e.target.value })}
          >
            <option value="">All types</option>
            {animeFormats.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="filter-select">
        <SlidersHorizontal size={15} />
        <select
          aria-label="Genre"
          value={genre}
          onChange={(e) => update({ genre: e.target.value })}
        >
          <option value="">All genres</option>
          {browseGenres.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label className="filter-select">
        <select
          aria-label="Sort titles"
          value={sort}
          onChange={(e) => update({ sort: e.target.value })}
        >
          <option value="trending">Most popular</option>
          <option value="score">Highest rated</option>
          <option value="newest">Newest first</option>
          <option value="title">A to Z</option>
        </select>
      </label>
    </div>
  );
  return (
    <div className="page browse-page" id={embedded ? `${chosen}-catalog` : undefined}>
      <div className="browse-heading">
        {embedded ? (
          <h2>{discovery ? 'Explore by genre' : `The ${chosen} collection`}</h2>
        ) : (
          <h1>{q ? `Results for “${q}”` : labels[chosen][0]}</h1>
        )}
        {!discovery && (
          <button
            className="browse-reset"
            onClick={() => {
              setParams({});
              setSearch('');
            }}
          >
            Reset filters <X size={13} />
          </button>
        )}
      </div>
      {!collectionControlsBelow && filters}
      {discovery ? (
        <GenreCollections
          category={chosen}
          collectionControls={collectionControlsBelow ? filters : null}
        />
      ) : (
        <>
          <div className="results-bar">
            <span>
              {data?.total
                ? `${data.total.toLocaleString()} ${data.totalIsEstimate ? 'saved stories available' : 'stories to discover'}`
                : loading
                  ? 'Finding stories…'
                  : `${itemsOf(data).length} stories`}
            </span>
            <span>
              {data?.providerUnavailable || data?.source === 'offline-cache'
                ? 'Showing saved results · live catalog is temporarily unavailable'
                : `${itemsOf(data).length} titles on this page`}
            </span>
            {(data?.providerUnavailable || data?.totalIsEstimate) && (
              <button onClick={refresh} disabled={loading}>
                Retry live catalog
              </button>
            )}
          </div>
          {error ? (
            <ErrorNotice message={error} retry={refresh} />
          ) : loading ? (
            <Loading cards />
          ) : itemsOf(data).length ? (
            <div className="poster-grid browse-grid">
              {itemsOf(data).map((media) => (
                <Poster key={media.id} media={media} compact />
              ))}
            </div>
          ) : (
            <Empty icon={Search} title="No plot twists here. Just no results.">
              Try another title or clear a filter to widen your search.
            </Empty>
          )}
          <div className="pagination">
            <button disabled={page === 1} onClick={() => update({ page: page - 1 })}>
              <ArrowLeft size={16} />
              Previous
            </button>
            <span>
              Page {page}
              {data?.pages ? ` of ${data.pages}` : ''}
            </span>
            <button
              disabled={!data || page >= (data.pages || 1)}
              onClick={() => update({ page: page + 1 })}
            >
              Next
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
