import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import HomeLead from './HomeLead';
import { Link, useSearchParams } from '../collection-router';
import { ArrowRight, BookOpen, Play, Sparkles, Swords, Heart, MoonStar } from 'lucide-react';
import { Loading } from '../components';
import '../home-category.css';
import { useCollection } from '../collection-context';

const ReadingHome = lazy(() =>
  import('./MangaPage').then((module) => ({ default: module.MangaLanding })),
);
const categories = [
  { value: 'anime', label: 'Anime', icon: Play },
  { value: 'manga', label: 'Manga', icon: BookOpen },
  { value: 'manhwa', label: 'Manhwa', icon: Sparkles },
];
const validCategory = (value) => categories.some((item) => item.value === value);
function savedCategory(key) {
  try {
    const value = localStorage.getItem(key);
    return validCategory(value) ? value : 'anime';
  } catch {
    return 'anime';
  }
}

function HomeCollection({ category }) {
  const genres = [
    {
      name: 'Fantasy',
      icon: Sparkles,
      tone: 'sage',
      description: 'Magic, myth, and worlds beyond.',
    },
    { name: 'Action', icon: Swords, tone: 'gold', description: 'Big stakes. No quiet moments.' },
    {
      name: 'Romance',
      icon: Heart,
      tone: 'rose',
      description: 'A little spark. A lasting connection.',
    },
    {
      name: 'Mystery',
      icon: MoonStar,
      tone: 'violet',
      description: 'One more clue. One more twist.',
    },
  ];
  return (
    <section className="home-explorer" aria-label={`Explore ${category}`}>
      <header className="home-explorer-heading">
        <div>
          <h2>More stories</h2>
        </div>
        <Link to={`/browse/${category}?view=all`} className="btn btn-secondary">
          Full collection <ArrowRight size={16} />
        </Link>
      </header>
      <div className="home-explorer-genres">
        {genres.map(({ name, icon: Icon, tone, description }) => (
          <Link
            key={name}
            className={`home-genre-card tone-${tone}`}
            to={`/browse/${category}?genre=${name}`}
          >
            <span className="home-genre-symbol">
              <Icon size={25} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <Icon
              className="home-genre-watermark"
              size={110}
              strokeWidth={0.7}
              aria-hidden="true"
            />
            <div>
              <h3>{name}</h3>
              <p>{description}</p>
            </div>
            <ArrowRight className="home-genre-arrow" size={17} aria-hidden="true" />
          </Link>
        ))}
      </div>
      <nav className="home-explorer-more" aria-label={`More ${category} genres`}>
        <span>Or try</span>
        {['Adventure', 'Comedy', 'Sci-Fi', 'Slice of Life'].map((genre) => (
          <Link key={genre} to={`/browse/${category}?genre=${encodeURIComponent(genre)}`}>
            {genre}
            <ArrowRight size={12} aria-hidden="true" />
          </Link>
        ))}
      </nav>
    </section>
  );
}

export default function Home() {
  const [params, setParams] = useSearchParams();
  const key = useCollection()?.active ? 'ara-ara:home-category' : 'yoru:home-category';
  const [saved] = useState(() => savedCategory(key));
  const requested = params.get('category');
  const category = validCategory(requested) ? requested : saved;
  const selected = categories.find((item) => item.value === category);
  const refs = useRef([]);
  const restoreFocus = useRef(null);
  useEffect(() => {
    try {
      localStorage.setItem(key, category);
    } catch {}
  }, [category]);
  const select = (value) => {
    const next = new URLSearchParams(params);
    next.set('category', value);
    setParams(next, { preventScrollReset: true });
  };
  const keyboardSelect = (event, index) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % 3
        : event.key === 'ArrowLeft'
          ? (index + 2) % 3
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 2
              : null;
    if (next === null) return;
    event.preventDefault();
    restoreFocus.current = categories[next].value;
    select(categories[next].value);
  };
  const categoryControls = (
    <div className="home-category-bar">
      <div className="home-category-switch" role="tablist" aria-label="Homepage category">
        {categories.map(({ value, label, icon: Icon }, index) => (
          <button
            key={value}
            ref={(node) => {
              refs.current[index] = node;
              if (node && restoreFocus.current === value) {
                restoreFocus.current = null;
                node.focus({ preventScroll: true });
              }
            }}
            role="tab"
            id={`home-category-${value}`}
            aria-controls="home-category-content"
            aria-selected={category === value}
            tabIndex={category === value ? 0 : -1}
            onClick={() => select(value)}
            onKeyDown={(event) => keyboardSelect(event, index)}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="home-page cinema-home category-home" data-category={category}>
      <div
        id="home-category-content"
        role="tabpanel"
        aria-labelledby={`home-category-${category}`}
        tabIndex={0}
      >
        <Suspense
          fallback={
            <div className="home-width">
              <Loading cards />
            </div>
          }
        >
          <div key={category} className="home-category-content">
            {category === 'anime' ? (
              <HomeLead categoryControls={categoryControls}>
                <HomeCollection category={category} />
              </HomeLead>
            ) : (
              <ReadingHome
                category={category}
                label={selected.label}
                homepage
                categoryControls={categoryControls}
              >
                <HomeCollection category={category} />
              </ReadingHome>
            )}
          </div>
        </Suspense>
      </div>
    </div>
  );
}
