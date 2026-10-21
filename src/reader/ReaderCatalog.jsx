import React, { useState } from 'react';
import { useReaderFeed } from './use-feed';
import { Poster, ErrorNotice, Loading } from '../components';
import CatalogIntegrationSelect from '../CatalogIntegrationSelect';
import { assertSourceEligible } from '../../shared/reading-eligibility';
import { visibleReadingItems } from './feed';
import './catalog.css';

export default function ReaderCatalog({
  category = 'manga',
  query = '',
  genre = '',
  source: initialSource = '',
  language: initialLanguage = '',
  heading = 'Enabled reading catalogs',
}) {
  const [source, setSource] = useState(initialSource);
  const [language, setLanguage] = useState(initialLanguage);
  const [sort, setSort] = useState('popular');
  const parameters = new URLSearchParams({ mode: query ? 'search' : sort, q: query, limit: '24' });
  if (source) parameters.set('source', source);
  if (language) parameters.set('language', language);
  const feed = useReaderFeed(`/api/reader/${query ? 'browse' : 'discovery'}?${parameters}`);
  const inventory = useReaderFeed('/api/reader/catalogs?limit=100');
  const selection = feed.selection;
  const context = selection?.context;
  const sources = (inventory.data?.sources || []).filter((item) => {
    if (!context) return false;
    try {
      assertSourceEligible(item, { ...context, extensionsEnabled: true }, { discovery: true });
      return true;
    } catch {
      return false;
    }
  });
  const languages = [...new Set(sources.map((item) => item.language).filter(Boolean))].sort();
  const items = visibleReadingItems(feed.data?.items || [], {
    context,
    category,
    genre,
    source,
    language,
  });
  const partial = feed.data?.sourceStates?.some((item) => !['ready', 'empty'].includes(item.state));
  return (
    <section className="content-section reader-catalog" aria-label={heading}>
      <div className="section-heading">
        <h2>{heading}</h2>
      </div>
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
            {feed.data?.hasMore
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
