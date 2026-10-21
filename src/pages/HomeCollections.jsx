import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Crown, Film, Layers, MessageCircle, ScanLine } from 'lucide-react';
import { Link } from '../collection-router';
import { itemsOf } from '../api';
import { useResource } from '../state';
import { Poster } from '../components';
import './home-collections.css';

const collections = [
  {
    id: 'anime',
    category: 'anime',
    name: 'Top anime',
    title: 'Anime worth making time for',
    description: 'The highest-rated anime in the catalog, across every year.',
    icon: Crown,
    accent: 'sage',
    note: 'ALL TIME',
  },
  {
    id: 'movies',
    category: 'anime',
    format: 'movie',
    name: 'Movie night',
    title: 'Make tonight a movie night',
    description: 'Highly rated anime films. One story, one evening.',
    icon: Film,
    accent: 'gold',
    note: 'ANIME FILMS',
  },
  {
    id: 'manga',
    category: 'manga',
    name: 'Manga essentials',
    title: 'Pages you’ll keep coming back to',
    description: 'Explore the highest-rated manga, from enduring classics to modern favorites.',
    icon: BookOpen,
    accent: 'rose',
    note: 'ALL TIME',
  },
  {
    id: 'manhwa',
    category: 'manhwa',
    name: 'Manhwa favorites',
    title: 'Find your next long scroll',
    description: 'Highly rated Korean comics, ready for your reading list.',
    icon: Layers,
    accent: 'violet',
    note: 'ALL TIME',
  },
  {
    id: 'oneshots',
    category: 'manga',
    format: 'oneshot',
    name: 'One-shot stories',
    title: 'A whole story in a single chapter',
    description: 'Discover manga one-shots: a small commitment with a lasting impression.',
    icon: ScanLine,
    accent: 'blue',
    note: 'QUICK READS',
  },
];

export default function HomeCollections({ category }) {
  const [selected, setSelected] = useState(category);
  const [active, setActive] = useState(false);
  const section = useRef(null);
  const tabs = useRef([]);
  const pick = collections.find((item) => item.id === selected) || collections[0];
  const query = new URLSearchParams({
    category: pick.category.toUpperCase(),
    sort: 'score',
    limit: '6',
    ...(pick.format ? { format: pick.format } : {}),
  });
  const { data, loading, error, refresh } = useResource(active ? `/api/catalog?${query}` : null);
  const items = itemsOf(data).slice(0, 6);
  const saved = data?.providerUnavailable || data?.totalIsEstimate;
  const listQuery = new URLSearchParams({
    sort: 'score',
    ...(pick.format ? { format: pick.format } : {}),
  });
  const destination = `/browse/${pick.category}?${listQuery}`;
  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: '1000px 0px' },
    );
    observer.observe(section.current);
    return () => observer.disconnect();
  }, []);
  const select = (index) => {
    setActive(true);
    setSelected(collections[index].id);
  };
  const keyboard = (event, index) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % collections.length
        : event.key === 'ArrowLeft'
          ? (index + collections.length - 1) % collections.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? collections.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    select(next);
    tabs.current[next]?.focus();
  };
  return (
    <section ref={section} className="home-collections" aria-label={`Explore ${category}`}>
      <header className="collections-heading">
        <div>
          <span className="eyebrow">THE GOOD STUFF</span>
          <h2>Find your next favorite</h2>
        </div>
        <p>Big classics. Movie nights. Small discoveries.</p>
      </header>
      <div className="collections-tabs" role="tablist" aria-label="Discovery collections">
        {collections.map(({ id, name, icon: Icon, accent, note }, index) => (
          <button
            key={id}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`collection-tab-${id}`}
            aria-controls="home-collection-list"
            aria-selected={pick.id === id}
            tabIndex={pick.id === id ? 0 : -1}
            className={`collection-tab accent-${accent}`}
            onClick={() => select(index)}
            onKeyDown={(event) => keyboard(event, index)}
          >
            <Icon size={22} aria-hidden="true" />
            <small>{note}</small>
            <strong>{name}</strong>
            <ArrowRight className="collection-tab-arrow" size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div
        id="home-collection-list"
        role="tabpanel"
        aria-labelledby={`collection-tab-${pick.id}`}
        tabIndex={0}
        aria-busy={loading || !active}
      >
        <header className="collection-list-heading">
          <div>
            <h3>{pick.title}</h3>
            <p>{pick.description}</p>
          </div>
          <Link to={destination} className="btn btn-secondary">
            View full list <ArrowRight size={15} />
          </Link>
        </header>
        {!active || loading ? (
          <div className="collections-posters" aria-label="Loading collection">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="collection-placeholder" />
            ))}
          </div>
        ) : error || !items.length ? (
          <div className="collection-empty" role="status">
            <p>
              {error || saved
                ? 'This collection is temporarily unavailable.'
                : 'No titles in this collection yet.'}
            </p>
            <button className="btn btn-secondary" onClick={refresh}>
              Try again
            </button>
          </div>
        ) : (
          <div className="collections-posters">
            {items.map((media, index) => (
              <Poster key={media.id} media={media} rank={saved ? undefined : index + 1} compact />
            ))}
          </div>
        )}
        <div className="collection-provenance">
          <span>
            {saved
              ? 'Saved picks · live rankings are temporarily unavailable.'
              : 'Sorted by catalog rating · MyAnimeList, with Kitsu as a fallback.'}
          </span>
          {saved && (
            <button onClick={refresh} disabled={loading}>
              Refresh rankings
            </button>
          )}
        </div>
      </div>
      <footer className="collections-community">
        <MessageCircle size={23} aria-hidden="true" />
        <div>
          <strong>What’s missing from everyone’s list?</strong>
          <p>Make a case for your favorite. Ask the community for your next watch or read.</p>
        </div>
        <Link to="/community?board=recommendations">
          Talk recommendations <ArrowRight size={16} />
        </Link>
      </footer>
    </section>
  );
}
