import React from 'react';
import { useReaderCatalog } from './use-catalog';
import { Poster, ErrorNotice, Loading } from '../components';
import CatalogIntegrationSelect from '../CatalogIntegrationSelect';
import { browseGenres } from '../pages/GenreCollections';
import './catalog.css';

export default function ReaderCatalog(props) {
  return props.catalog ? <ReaderCatalogView {...props} /> : <StandaloneReaderCatalog {...props} />;
}
function StandaloneReaderCatalog(props) {
  const catalog = useReaderCatalog(props);
  return <ReaderCatalogView {...props} catalog={catalog} />;
}
function ReaderCatalogView({ catalog, query = '', heading = 'Enabled reading catalogs' }) {
  const {
    feed,
    inventory,
    selection,
    context,
    sources,
    languages,
    source,
    setSource,
    language,
    setLanguage,
    sort,
    setSort,
    items,
    allItems,
    genres,
    genre,
    setGenre,
    partial,
  } = catalog;
  const genreChoices = [...new Set([...browseGenres, ...genres, ...(genre ? [genre] : [])])];
  const quickGenres = [...new Set([...browseGenres, ...(genre ? [genre] : [])])];
  return (
    <section className="content-section reader-catalog" aria-label={heading}>
      <div className="section-heading">
        <h2>{heading}</h2>
      </div>
      <nav className="genre-jump-list reader-genre-list" aria-label="Explore reading genres">
        {['', ...quickGenres].map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={genre === value}
            onClick={() => setGenre(value)}
          >
            {value || 'All genres'}
          </button>
        ))}
      </nav>
      <div className="filter-bar" role="region" aria-label="Reading catalog filters">
        <CatalogIntegrationSelect
          className="filter-select"
          value={context?.integrationMode || 'all'}
          disabled={!selection?.ready || context?.scope === null}
          onChange={(mode) => {
            setSource('');
            void selection.setIntegrationMode(mode);
          }}
        />
        <label className="filter-select">
          Extension source
          <select
            aria-label="Reading source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">All enabled sources</option>
            {sources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.providerKey} · {item.language || 'Unknown language'}
                {item.integration === 'suwayomi' ? ' · extension' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-select">
          Language
          <select
            aria-label="Reading language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="">All languages</option>
            {languages.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="filter-select">
          Genre
          <select
            aria-label="Reading genre"
            value={genre}
            onChange={(event) => setGenre(event.target.value)}
          >
            <option value="">All genres</option>
            {genreChoices.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {!query && (
          <label className="filter-select">
            Sort
            <select
              aria-label="Reading sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="popular">Popular on source</option>
              <option value="latest">Recently updated</option>
            </select>
          </label>
        )}
        {inventory.data?.hasMore && (
          <button onClick={inventory.loadMore} disabled={inventory.loading}>
            More source filters
          </button>
        )}
      </div>
      <p className="muted" role="status">
        {feed.loading && !feed.data
          ? 'Loading enabled catalogs…'
          : `${items.length} titles loaded · Total unknown`}
        {genre ? ` · ${genre}` : ''}
        {partial ? ' · Some sources are unavailable' : ''}
      </p>
      {partial && (
        <details className="reader-source-status">
          <summary>Source availability</summary>
          <ul>
            {feed.data.sourceStates
              .filter((item) => !['ready', 'empty'].includes(item.state))
              .map((item, index) => (
                <li key={`${item.sourceId}:${index}`}>
                  {sources.find((source) => source.id === item.sourceId)?.providerKey ||
                    item.sourceId}
                  : {String(item.reason || item.state).replaceAll('-', ' ')}
                  {item.retryAt && (
                    <>
                      {' '}
                      · Retry after{' '}
                      <time dateTime={item.retryAt}>
                        {new Date(item.retryAt).toLocaleTimeString()}
                      </time>
                    </>
                  )}
                </li>
              ))}
          </ul>
          <button className="btn btn-subtle" onClick={feed.refresh}>
            Retry catalog
          </button>
        </details>
      )}
      {feed.error && <ErrorNotice message={feed.error} retry={feed.refresh} />}
      {feed.loading && !feed.data ? (
        <Loading cards />
      ) : items.length ? (
        <div className="poster-grid browse-grid">
          {items.map((media) => (
            <Poster key={media.id} media={media} compact />
          ))}
        </div>
      ) : (
        !feed.error && (
          <p className="muted">
            {genre && allItems.length && !genres.length
              ? 'These titles do not have genre tags yet. Choose All genres to see them.'
              : feed.data?.hasMore
                ? 'No matches in this batch. Continue to check more enabled sources.'
                : 'No matching titles from the enabled catalogs.'}
          </p>
        )
      )}
      {feed.data?.hasMore && (
        <button className="btn btn-subtle" onClick={feed.loadMore} disabled={feed.loading}>
          {feed.loading ? 'Loading more…' : 'Load more titles'}
        </button>
      )}
    </section>
  );
}
