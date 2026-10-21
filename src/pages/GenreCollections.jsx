import React, { useEffect, useRef, useState } from 'react';
import { Link } from '../collection-router';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { itemsOf } from '../api';
import { useResource } from '../state';
import { Poster } from '../components';
import './genre-collections.css';
import { useCollection } from '../collection-context';
import { imageLookahead } from '../image-loading';

export const browseGenres = [
  'Action',
  'Adventure',
  'Fantasy',
  'Romance',
  'Comedy',
  'Drama',
  'Mystery',
  'Sci-Fi',
  'Slice of Life',
  'Supernatural',
  'Sports',
  'Horror',
  'Suspense',
];
const genreId = (category, genre) =>
  `${category}-shelf-${genre.toLowerCase().replaceAll(' ', '-')}`;

function CollectionShelf({ category, genre = '', children }) {
  const section = useRef();
  const track = useRef();
  const [active, setActive] = useState(false);
  const [page, setPage] = useState(1);
  const [edges, setEdges] = useState({ start: true, end: true });
  const heading = genre || 'Full collection';
  const query = new URLSearchParams({
    category: category.toUpperCase(),
    genre,
    sort: 'trending',
    page,
    limit: '12',
  });
  const { data, loading, error, refresh } = useResource(active ? `/api/catalog?${query}` : null);
  const items = itemsOf(data).slice(0, 12);
  const hasNext = data?.pageInfo?.hasNextPage ?? page < (data?.pages || 1);
  const unavailable = data?.providerUnavailable || data?.totalIsEstimate;
  const destination = `/browse/${category}?${genre ? `genre=${encodeURIComponent(genre)}` : 'view=all'}`;
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: `${imageLookahead(true)}px 0px` },
    );
    observer.observe(section.current);
    return () => observer.disconnect();
  }, []);
  const measure = () => {
    const el = track.current;
    if (el)
      setEdges({
        start: el.scrollLeft < 4,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
      });
  };
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: 0, behavior: 'instant' });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [data, loading]);
  const move = (direction) => {
    const el = track.current;
    if (!el) {
      if (direction < 0) setPage((current) => Math.max(1, current - 1));
      return;
    }
    if ((direction > 0 && edges.end) || (direction < 0 && edges.start)) {
      setPage((current) => Math.max(1, current + direction));
    } else {
      const reduced =
        matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.documentElement.dataset.reduceMotion === 'true';
      el.scrollBy({ left: direction * el.clientWidth, behavior: reduced ? 'instant' : 'smooth' });
    }
  };
  return (
    <section
      ref={section}
      className="genre-collection"
      id={genreId(category, genre || 'all')}
      aria-label={genre ? `${genre} collection` : 'Full collection'}
    >
      <header className="genre-collection-heading">
        <div>
          <h2>{heading}</h2>
          <p>
            {genre
              ? `Discover ${genre.toLowerCase()} ${category}`
              : `Every ${category}, ready to explore`}
          </p>
        </div>
        <div className="genre-collection-actions">
          <Link to={destination} aria-label={`Show more ${heading.toLowerCase()}`}>
            Show more <ArrowRight size={14} />
          </Link>
          <button
            aria-label={`Previous ${heading.toLowerCase()} titles`}
            disabled={!active || loading || (page === 1 && edges.start)}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            aria-label={`Next ${heading.toLowerCase()} titles`}
            disabled={!active || loading || error || (edges.end && !hasNext)}
            onClick={() => move(1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </header>
      {children}
      {!active || loading ? (
        <div
          className="genre-shelf-track genre-shelf-loading"
          aria-label={`Loading ${heading.toLowerCase()}`}
        >
          {Array.from({ length: 12 }, (_, i) => (
            <div className="genre-shelf-placeholder" key={i}>
              <div />
              <span />
            </div>
          ))}
        </div>
      ) : error || !items.length ? (
        <div className="genre-shelf-empty">
          <p>
            {error || unavailable
              ? 'This collection is temporarily unavailable.'
              : `No ${genre ? genre.toLowerCase() + ' ' : ''}${category} titles found yet.`}
          </p>
          {(error || unavailable) && <button onClick={refresh}>Try again</button>}
        </div>
      ) : (
        <div ref={track} className="genre-shelf-track" onScroll={measure}>
          {items.map((media) => (
            <Poster key={media.id} media={media} compact />
          ))}
        </div>
      )}
      <footer className="genre-shelf-footer" aria-live="polite">
        <span>{items.length ? `Selection ${page} · ${items.length} titles` : ''}</span>
        {unavailable && (
          <button onClick={refresh} disabled={loading}>
            Saved collection · Retry live catalog
          </button>
        )}
      </footer>
    </section>
  );
}

export default function GenreCollections({ category }) {
  const scope = useCollection();
  const genres = scope?.active
    ? browseGenres.filter((genre) =>
        scope.catalog?.items.some(
          (item) => item.category.toLowerCase() === category && item.genres?.includes(genre),
        ),
      )
    : browseGenres;
  return (
    <div className="genre-collections" key={category}>
      <nav className="genre-jump-list" aria-label="Explore genres">
        {genres.map((genre) => (
          <a key={genre} href={`#${genreId(category, genre)}`}>
            {genre}
          </a>
        ))}
        <a href={`#${genreId(category, 'all')}`}>
          Full collection <ArrowRight size={12} />
        </a>
      </nav>
      {genres.map((genre) => (
        <CollectionShelf key={`${category}-${genre}`} category={category} genre={genre} />
      ))}
      <CollectionShelf key={`${category}-all`} category={category} />
    </div>
  );
}
