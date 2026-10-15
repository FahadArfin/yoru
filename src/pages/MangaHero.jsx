import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Check, ChevronLeft, ChevronRight, Plus, Star } from 'lucide-react';
import { coverOf, titleOf } from '../api';
import { useApp } from '../state';
import { useBannerArtwork } from '../useBannerArtwork';

export default function MangaHero({ items, category, label }) {
  const [selected, setSelected] = useState(null);
  const { entryFor, updateEntry } = useApp();
  const picks = items.slice(0, 8);
  const index = Math.max(
    0,
    picks.findIndex((item) => item.id === selected),
  );
  const hero = picks[index];
  const artwork = useBannerArtwork(picks, hero?.id);
  const wide = hero && artwork.featured.some((item) => item.id === hero.id);
  const change = (step) => setSelected(picks[(index + step + picks.length) % picks.length].id);
  return (
    <section
      ref={artwork.ref}
      className={`weekly-hero manga-hero ${wide ? 'has-wide-art' : 'manga-cover-layout'}`}
      aria-label={`Featured ${category}`}
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
      <div className="weekly-shade" />
      {!wide && hero && (
        <div className="manga-cover-stage" key={hero.id}>
          <span className="manga-cover-orbit" />
          <img
            src={coverOf(hero)}
            alt={`${titleOf(hero)} cover`}
            fetchPriority="high"
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden';
            }}
          />
          <span className="manga-cover-label">
            {category === 'manhwa' ? 'COLOR. SCROLL. OBSESSION.' : 'INK. PANELS. OBSESSION.'}
          </span>
        </div>
      )}
      <div className="weekly-content">
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
              <Link className="weekly-watch" to={`/title/${hero.id}`}>
                <BookOpen size={17} /> Explore {category}
              </Link>
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
            <button aria-label={`Previous featured ${category}`} onClick={() => change(-1)}>
              <ChevronLeft size={18} />
            </button>
            {picks.map((item) => (
              <button
                key={item.id}
                className={`weekly-dot ${hero.id === item.id ? 'active' : ''}`}
                aria-label={`Feature ${titleOf(item)}`}
                aria-current={hero.id === item.id ? 'true' : undefined}
                onClick={() => setSelected(item.id)}
              />
            ))}
            <span>
              {String(index + 1).padStart(2, '0')}
              <small> / {String(picks.length).padStart(2, '0')}</small>
            </span>
            <button aria-label={`Next featured ${category}`} onClick={() => change(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
