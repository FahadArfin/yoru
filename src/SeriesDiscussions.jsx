import React, { useState } from 'react';
import { Link } from './collection-router';
import { ArrowLeft, ArrowRight, Search, MessageCircle } from 'lucide-react';
import { useResource } from './state';
import { titleOf } from './api';
import { ErrorNotice } from './components';
import CoverImage from './CoverImage';
import useEpisodeAvailability from './useEpisodeAvailability';
import { chapterListPath } from './reader/requests';

function SeriesUnits({ media, onBack }) {
  const anime = media.category === 'ANIME';
  const [page, setPage] = useState(1),
    [offsets, setOffsets] = useState([0]),
    [source, setSource] = useState('mangadex');
  const sources = useResource(anime ? null : `/api/media/${media.id}/reading-sources`);
  const result = useResource(
    anime
      ? `/api/media/${media.id}/episodes?page=${page}`
      : chapterListPath(media.id, {
          source,
          language: 'all',
          sort: 'asc',
          offset: offsets[page - 1] || 0,
        }),
    false,
  );
  const availability = useEpisodeAvailability(media, anime ? result.data : null);
  let items = result.data?.items || [];
  if (
    anime &&
    !items.length &&
    !result.loading &&
    /^(finished airing|finished)$/i.test(media.status || '')
  )
    items = Array.from(
      { length: Math.max(0, Math.min(100, (media.episodes || 0) - (page - 1) * 100)) },
      (_, i) => ({
        number: (page - 1) * 100 + i + 1,
        title: `Episode ${(page - 1) * 100 + i + 1}`,
      }),
    );
  items = [
    ...new Map(
      items
        .filter(
          (x) =>
            Number.isInteger(Number(x.number)) &&
            Number(x.number) > 0 &&
            Number(x.number) <= 100000,
        )
        .map((x) => [Number(x.number), x]),
    ).values(),
  ];
  const next = anime
    ? Boolean(result.data?.hasNext || page < Math.ceil((media.episodes || 0) / 100))
    : result.data?.nextOffset != null;
  return (
    <div className="forum-series-detail">
      <button className="text-link" onClick={onBack}>
        <ArrowLeft size={14} /> Choose another series
      </button>
      <div className="forum-series-heading">
        <CoverImage media={media} alt="" />
        <div>
          <h4>{titleOf(media)}</h4>
          <p>
            {anime ? 'Episode' : 'Chapter'} discussions · replies are shared with the{' '}
            {anime ? 'player' : 'reader'}.
          </p>
        </div>
      </div>
      {!anime && (
        <label className="forum-source">
          Chapter source
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPage(1);
              setOffsets([0]);
            }}
          >
            {[
              { id: 'mangadex', name: 'MangaDex' },
              ...(sources.data?.sources || []).filter((s) => s.id !== 'mangadex'),
            ].map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {result.loading && <p role="status">Finding {anime ? 'episodes' : 'chapters'}…</p>}
      {result.error && <ErrorNotice message={result.error} retry={result.refresh} />}
      {result.data?.partial && (
        <p className="muted">Some release details are temporarily unavailable.</p>
      )}
      <div className="forum-unit-list">
        {items.map((item) => {
          const number = Number(item.number),
            state = anime
              ? availability.state(number)
              : item.publishedAt && Date.parse(item.publishedAt) > Date.now()
                ? 'unreleased'
                : 'released';
          return (
            <div className="forum-unit" key={number}>
              {state === 'released' ? (
                <Link to={`/community/${media.id}/${number}`}>
                  <span>
                    {anime ? 'Episode' : 'Chapter'} {number}
                  </span>
                  <small>{item.title || 'Join the discussion'}</small>
                  <MessageCircle size={15} />
                </Link>
              ) : (
                <span className="forum-unit-unavailable">
                  <span>
                    {anime ? 'Episode' : 'Chapter'} {number}
                  </span>
                  <small>
                    {state === 'unreleased' ? 'Not released yet' : 'Release not confirmed'}
                  </small>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {!result.loading && !result.error && !items.length && (
        <p className="forum-empty">
          No numbered releases are available here yet. Try another chapter source or return after
          the next release.
        </p>
      )}
      <nav className="forum-pagination" aria-label="Series discussion pages">
        <button
          className="btn"
          disabled={page <= 1 || result.loading}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          className="btn"
          disabled={!next || result.loading}
          onClick={() => {
            if (!anime)
              setOffsets((old) => {
                const copy = [...old];
                copy[page] = result.data.nextOffset;
                return copy;
              });
            setPage((p) => p + 1);
          }}
        >
          Next
        </button>
      </nav>
    </div>
  );
}
export default function SeriesDiscussions({ initialCategory = 'anime' }) {
  const [category, setCategory] = useState(initialCategory),
    [draft, setDraft] = useState(''),
    [query, setQuery] = useState(''),
    [selected, setSelected] = useState(null);
  const results = useResource(
    !selected && query
      ? `/api/catalog?${new URLSearchParams({ category: category.toUpperCase(), search: query, limit: '12' })}`
      : null,
  );
  return (
    <section className="forum-series" aria-label="Browse series discussions">
      <div className="section-heading">
        <div>
          <h3>Every story has a conversation</h3>
          <p>Find a series, then choose an episode or chapter.</p>
        </div>
      </div>
      {selected ? (
        <SeriesUnits key={selected.id} media={selected} onBack={() => setSelected(null)} />
      ) : (
        <>
          <form
            className="forum-series-search"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(draft.trim());
            }}
          >
            <select
              aria-label="Series category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setQuery('');
              }}
            >
              {['anime', 'manga', 'manhwa'].map((c) => (
                <option key={c} value={c}>
                  {c === 'anime' ? 'Anime' : c === 'manga' ? 'Manga' : 'Manhwa'}
                </option>
              ))}
            </select>
            <Search size={16} />
            <input
              type="search"
              aria-label="Find a series discussion"
              placeholder="Search for a series…"
              value={draft}
              maxLength={100}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="btn btn-secondary">Find series</button>
          </form>
          {results.error && <ErrorNotice message={results.error} retry={results.refresh} />}
          {results.loading && <p role="status">Finding series…</p>}
          <div className="forum-series-results">
            {(results.data?.items || []).map((media) => (
              <button key={media.id} onClick={() => setSelected(media)}>
                <CoverImage media={media} alt="" />
                <span>
                  <strong>{titleOf(media)}</strong>
                  <small>
                    {media.year || ''} · {media.format || media.category}
                  </small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
          {query && !results.loading && !results.error && !results.data?.items?.length && (
            <p>No series found. Try another name.</p>
          )}
        </>
      )}
    </section>
  );
}
