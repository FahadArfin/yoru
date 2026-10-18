import React, { useEffect, useState } from 'react';
import { BookOpen, Check, ChevronLeft, ChevronRight, Plus, Star, Pause, Play } from 'lucide-react';
import { titleOf } from '../api';
import CoverImage from '../CoverImage';
import PrefetchLink from '../PrefetchLink';
import { useApp } from '../state';
import { useBannerArtwork } from '../useBannerArtwork';
import { isReadingBanner } from '../banner-quality';
import { useHeroCarousel } from '../useHeroCarousel';
import HeroArtwork from '../HeroArtwork';
import { coverCandidates, warmImage } from '../image-loading';

export default function MangaHero({ items, category, label }) {
  const [selected, setSelected] = useState(null);
  const { entryFor, updateEntry } = useApp();
  const picks = items.slice(0, 8);
  const index = Math.max(
    0,
    picks.findIndex((item) => item.id === selected),
  );
  const hero = picks[index];
  const artwork = useBannerArtwork(picks, hero?.id, isReadingBanner);
  const wide = hero && artwork.featured.some((item) => item.id === hero.id);
  const carousel = useHeroCarousel(picks, hero?.id, setSelected, artwork.ref);
  const nextCovers = JSON.stringify(
    [1, -1]
      .map((step) => coverCandidates(picks[(index + step + picks.length) % picks.length])[0])
      .filter(Boolean),
  );
  useEffect(() => {
    const controller = new AbortController();
    for (const url of JSON.parse(nextCovers)) warmImage(url, controller.signal);
    return () => controller.abort();
  }, [nextCovers]);
  return (
    <section
      ref={artwork.ref}
      className={`weekly-hero manga-hero ${wide ? 'has-wide-art' : 'manga-cover-layout'}${carousel.dragging ? ' is-dragging' : ''}`}
      aria-label={`Featured ${category}`}
      {...carousel.bindings}
    >
      <HeroArtwork
        identity={hero ? `${hero.id}:${wide ? hero.banner : 'cover'}` : null}
        offset={carousel.offset}
      >
        {wide && (
          <img
            key={hero.banner}
            className="weekly-backdrop"
            src={hero.banner}
            alt=""
            fetchPriority="high"
            onError={() => artwork.reject(hero.banner)}
          />
        )}
        {!wide && hero && (
          <div className="manga-cover-stage" key={hero.id} aria-hidden="true">
            <CoverImage media={hero} alt="" loading="eager" fetchPriority="high" />
          </div>
        )}
      </HeroArtwork>
      <div className="weekly-shade" />
      <div className="weekly-content" key={hero?.id}>
        <span className="weekly-kicker">
          <BookOpen size={16} /> THE {category.toUpperCase()} COLLECTION{' '}
          <span className="weekly-line" />
        </span>
        <h1 className="sr-only">{label}</h1>
        <h2 key={hero?.id}>
          {hero ? (
            titleOf(hero)
          ) : (
            <>
              One more
              <br />
              chapter.
            </>
          )}
        </h2>
        {hero ? (
          <>
            <div className="weekly-meta">
              <span>{category.toUpperCase()}</span>
              {hero.year && <span>{hero.year}</span>}
              <span className="weekly-airing">{hero.status}</span>
              {hero.score > 0 && (
                <span className="manga-rating">
                  <Star size={12} fill="currentColor" /> {Number(hero.score).toFixed(1)}
                </span>
              )}
              <span className="weekly-genres">{hero.genres?.slice(0, 2).join(' · ')}</span>
            </div>
            <p className="weekly-description">
              {hero.description || 'Find your next favorite story, one panel at a time.'}
            </p>
            <div className="weekly-actions">
              <PrefetchLink media={hero} className="weekly-watch" to={`/title/${hero.id}`}>
                <BookOpen size={17} /> Explore {category}
              </PrefetchLink>
              <button
                className="weekly-save"
                aria-label={entryFor(hero) ? 'In your library' : 'Add to reading list'}
                onClick={() => updateEntry(hero, { status: entryFor(hero)?.status || 'planned' })}
              >
                {entryFor(hero) ? <Check size={18} /> : <Plus size={18} />}
                <span>{entryFor(hero) ? 'In your library' : 'Reading list'}</span>
              </button>
            </div>
          </>
        ) : (
          <p className="weekly-description">
            Big worlds. Unforgettable characters. Find the story you can’t put down.
          </p>
        )}
      </div>
      {picks.length > 0 && (
        <div className="weekly-bottom">
          <span className="weekly-caption">
            Your next reading obsession <span> / </span> {label}
          </span>
          <div className="weekly-controls" aria-label={`Featured ${category} controls`}>
            {picks.length > 1 && !carousel.reduced && (
              <button
                aria-label={carousel.paused ? 'Resume banner rotation' : 'Pause banner rotation'}
                onClick={carousel.togglePause}
              >
                {carousel.paused ? <Play size={15} /> : <Pause size={15} />}
              </button>
            )}
            <button aria-label={`Previous featured ${category}`} onClick={() => carousel.move(-1)}>
              <ChevronLeft size={18} />
            </button>
            {picks.map((item) => (
              <button
                key={item.id}
                className={`weekly-dot ${hero.id === item.id ? 'active' : ''}`}
                aria-label={`Feature ${titleOf(item)}`}
                aria-current={hero.id === item.id ? 'true' : undefined}
                onClick={() => carousel.select(item.id)}
              />
            ))}
            <span>
              {String(index + 1).padStart(2, '0')}
              <small> / {String(picks.length).padStart(2, '0')}</small>
            </span>
            <button aria-label={`Next featured ${category}`} onClick={() => carousel.move(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
