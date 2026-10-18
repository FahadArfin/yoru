import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import HomeLead from './HomeLead';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, Play, Sparkles } from 'lucide-react';
import { useApp, useResource } from '../state';
import { bannerOf, isAnime, itemsOf, kindOf, titleOf } from '../api';
import { ErrorNotice, Loading, Poster, Section } from '../components';
import '../home-category.css';

const ReadingHome = lazy(() =>
  import('./MangaPage').then((module) => ({ default: module.MangaLanding })),
);
const categories = [
  { value: 'anime', label: 'Anime', icon: Play, detail: 'Your next episode' },
  { value: 'manga', label: 'Manga', icon: BookOpen, detail: 'Your next chapter' },
  { value: 'manhwa', label: 'Manhwa', icon: Sparkles, detail: 'Your next obsession' },
];
const validCategory = (value) => categories.some((item) => item.value === value);
function savedCategory() {
  try {
    const value = localStorage.getItem('yoru:home-category');
    return validCategory(value) ? value : 'anime';
  } catch {
    return 'anime';
  }
}

function HomeCollection({ category }) {
  const current = useResource(`/api/catalog?category=${category.toUpperCase()}&curated=1`);
  const { library } = useApp();
  const inProgress = library.filter(
    (item) =>
      item.media &&
      kindOf(item.media).toLowerCase() === category &&
      ['watching', 'reading', 'current'].includes(item.status) &&
      item.progress > 0,
  );
  return (
    <div className="home-secondary">
      {inProgress.length > 0 && (
        <Section
          eyebrow="RIGHT WHERE YOU LEFT OFF"
          title={category === 'anime' ? 'One more episode.' : 'One more chapter.'}
          href="/library"
        >
          <div className="continue-grid">
            {inProgress.slice(0, 3).map((entry) => (
              <Link
                key={entry.mediaId}
                to={`/${isAnime(entry.media) ? 'watch' : 'read'}/${entry.mediaId}/${Math.max(1, entry.progress)}`}
                className="continue-card"
              >
                <img src={bannerOf(entry.media)} alt="" />
                <span className="continue-play">
                  {isAnime(entry.media) ? <Play size={19} /> : <BookOpen size={19} />}
                </span>
                <div>
                  <strong>{titleOf(entry.media)}</strong>
                  <span>
                    {isAnime(entry.media) ? 'Episode' : 'Chapter'} {entry.progress} · Pick it back
                    up
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      )}
      <div className="home-columns">
        <div className="home-primary">
          <Section
            eyebrow="MORE STORIES, MORE WORLDS"
            title={`Explore the ${category} collection`}
            href={`/browse/${category}`}
          >
            {current.loading ? (
              <Loading cards />
            ) : current.error ? (
              <ErrorNotice message={current.error} retry={current.refresh} />
            ) : (
              <div className="poster-grid home-poster-grid">
                {itemsOf(current.data)
                  .slice(0, 6)
                  .map((media) => (
                    <Poster key={media.id} media={media} />
                  ))}
              </div>
            )}
          </Section>
        </div>
      </div>
      <div className="home-ending">
        <span>✦</span>
        <p>
          You bring the curiosity.
          <br />
          <strong>We’ll bring the stories.</strong>
        </p>
        <Link to={`/browse/${category}`} className="btn btn-subtle">
          Explore {category} <ArrowRight size={17} />
        </Link>
      </div>
    </div>
  );
}

export default function Home() {
  const [params, setParams] = useSearchParams();
  const [saved] = useState(savedCategory);
  const requested = params.get('category');
  const category = validCategory(requested) ? requested : saved;
  const selected = categories.find((item) => item.value === category);
  const refs = useRef([]);
  useEffect(() => {
    try {
      localStorage.setItem('yoru:home-category', category);
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
    select(categories[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className="home-page cinema-home category-home" data-category={category}>
      <div className="home-category-bar home-width">
        <div className="home-category-intro">
          <span>MAKE YOURSELF AT HOME</span>
          <strong>{selected.detail} starts here.</strong>
        </div>
        <div className="home-category-switch" role="tablist" aria-label="Homepage category">
          {categories.map(({ value, label, icon: Icon }, index) => (
            <button
              key={value}
              ref={(node) => {
                refs.current[index] = node;
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
              <HomeLead>
                <HomeCollection category={category} />
              </HomeLead>
            ) : (
              <ReadingHome category={category} label={selected.label} homepage>
                <HomeCollection category={category} />
              </ReadingHome>
            )}
          </div>
        </Suspense>
      </div>
    </div>
  );
}
