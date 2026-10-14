import React, { useEffect, useState } from 'react';
import HomeSidebar from './HomeSidebar';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flame,
  Play,
  Plus,
  RotateCw,
} from 'lucide-react';
import { useApp, useResource } from '../state';
import { ago, coverOf, titleOf } from '../api';
import { useBannerArtwork } from '../useBannerArtwork';

const fallbackImage = (event) => {
  const image = event.currentTarget;
  if (image.dataset.failed) return;
  image.dataset.failed = '1';
  image.src = '/icon.svg';
};
export default function HomeLead({ children }) {
  const [language, setLanguage] = useState('sub');
  const home = useResource(`/api/home?language=${language}`);
  const [failedLogo, setFailedLogo] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [, tick] = useState(0);
  const { entryFor, updateEntry } = useApp();
  const popular = home.data?.hot || [];
  const artwork = useBannerArtwork(popular, selectedId);
  const { featured } = artwork;
  const index = Math.max(
    0,
    featured.findIndex((x) => x.id === selectedId),
  );
  const hero = featured[index];
  useEffect(() => {
    if (hero) setSelectedId(hero.id);
  }, [hero?.id]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) {
        tick((x) => x + 1);
        home.refresh();
      }
    }, 120000);
    return () => clearInterval(timer);
  }, [language]);
  const releases = home.data?.releases || [];
  const unavailable = home.error || ['not-configured', 'unavailable'].includes(home.data?.state);
  return (
    <>
      <section ref={artwork.ref} className="weekly-hero has-wide-art" aria-label="Hot this week">
        {hero && (
          <img
            key={hero.id}
            className="weekly-backdrop"
            src={hero.banner}
            alt=""
            fetchPriority="high"
            onError={() => artwork.reject(hero.banner)}
          />
        )}
        <div className="weekly-shade" />
        <div className="weekly-content">
          <span className="weekly-kicker">
            <Flame size={15} /> HOT THIS WEEK <span className="weekly-line" />
          </span>
          {hero ? (
            <>
              <h1
                key={hero.id}
                className={hero.logo && failedLogo !== hero.id ? 'has-title-logo' : undefined}
              >
                {hero.logo && failedLogo !== hero.id ? (
                  <>
                    <img
                      className="weekly-title-logo"
                      src={hero.logo}
                      alt=""
                      onError={() => setFailedLogo(hero.id)}
                    />
                    <span className="sr-only">{titleOf(hero)}</span>
                  </>
                ) : (
                  titleOf(hero)
                )}
              </h1>
              <div className="weekly-meta">
                <span>{hero.format}</span>
                {hero.year && <span>{hero.year}</span>}
                <span className="weekly-airing">Airing now</span>
                <span className="weekly-genres">{hero.genres?.slice(0, 2).join(' · ')}</span>
              </div>
              <div className="weekly-actions">
                <Link className="weekly-watch" to={`/title/${hero.id}`}>
                  <Play size={17} fill="currentColor" /> Explore series
                </Link>
                <button
                  className="weekly-save"
                  aria-label={entryFor(hero) ? 'In your library' : 'Add to watchlist'}
                  onClick={() => updateEntry(hero, { status: entryFor(hero)?.status || 'planned' })}
                >
                  {entryFor(hero) ? <Check size={18} /> : <Plus size={18} />}
                  <span>{entryFor(hero) ? 'In your library' : 'Watchlist'}</span>
                </button>
              </div>
            </>
          ) : home.loading || artwork.loading ? (
            <div className="weekly-loading" aria-label="Loading weekly picks">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <>
              <h1>
                Your next
                <br />
                late night.
              </h1>
              <p className="weekly-description">
                {unavailable
                  ? 'Weekly picks are temporarily unavailable. There are still thousands of stories to discover.'
                  : 'Explore a universe of anime, manga, and manhwa.'}
              </p>
              <Link className="weekly-watch" to="/browse/anime">
                Explore anime <ArrowRight size={17} />
              </Link>
            </>
          )}
        </div>
        {featured.length > 0 && (
          <div className="weekly-bottom">
            <span className="weekly-caption" title={home.data.ranking}>
              Popular anime airing this week <span> / </span> AnimeSchedule
            </span>
            <div className="weekly-controls" aria-label="Featured anime">
              <button
                aria-label="Previous featured title"
                onClick={() =>
                  setSelectedId(featured[(index - 1 + featured.length) % featured.length].id)
                }
              >
                <ChevronLeft size={18} />
              </button>
              {featured.map((media) => (
                <button
                  key={media.id}
                  className={`weekly-dot ${hero.id === media.id ? 'active' : ''}`}
                  aria-label={`Feature ${titleOf(media)}`}
                  aria-current={hero.id === media.id ? 'true' : undefined}
                  onClick={() => setSelectedId(media.id)}
                />
              ))}
              <span>
                {String((index % featured.length) + 1).padStart(2, '0')}
                <small> / {String(featured.length).padStart(2, '0')}</small>
              </span>
              <button
                aria-label="Next featured title"
                onClick={() => setSelectedId(featured[(index + 1) % featured.length].id)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </section>
      <div className="home-content-layout home-width">
        <div className="home-release-column">
          <section className="release-section" aria-labelledby="released-heading">
            <div className="release-heading">
              <div>
                <span className="release-eyebrow">
                  <span /> FRESH OFF THE SCHEDULE
                </span>
                <h2 id="released-heading">
                  Just released<span className="heading-period">.</span>
                </h2>
              </div>
              <div className="release-tools">
                <div className="release-language" aria-label="Release language">
                  {['sub', 'dub'].map((value) => (
                    <button
                      key={value}
                      aria-label={`English ${value}`}
                      aria-pressed={language === value}
                      className={language === value ? 'active' : ''}
                      onClick={() => setLanguage(value)}
                    >
                      {value === 'sub' ? 'Sub' : 'Dub'}
                    </button>
                  ))}
                </div>
                <Link className="release-schedule" to="/schedule">
                  <CalendarDays size={15} /> Full schedule <ArrowRight size={15} />
                </Link>
              </div>
            </div>
            {home.data?.stale && releases.length > 0 && (
              <div className="release-notice">
                Showing the latest saved releases.{' '}
                <button onClick={home.refresh}>
                  Refresh <RotateCw size={12} />
                </button>
              </div>
            )}
            {home.loading && !home.data ? (
              <div className="release-grid" aria-label="Loading releases">
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="release-skeleton" />
                ))}
              </div>
            ) : releases.length ? (
              <div className="release-grid">
                {releases.map((entry) => {
                  const content = (
                    <>
                      <div className="release-poster">
                        <img
                          src={entry.cover || coverOf(entry.media)}
                          alt=""
                          loading="lazy"
                          onError={fallbackImage}
                        />
                        <span className="release-play">
                          <Play size={23} fill="currentColor" />
                        </span>
                        <span className="release-badges">
                          <span>{language.toUpperCase()}</span>
                          <strong>EP {entry.episode}</strong>
                        </span>
                      </div>
                      <div className="release-info">
                        <h3>{entry.title}</h3>
                        <span>
                          <Clock3 size={11} />
                          <time
                            dateTime={entry.airingAt}
                            title={new Date(entry.airingAt).toLocaleString()}
                          >
                            {ago(entry.airingAt)}
                          </time>
                          <i>·</i>
                          {entry.media?.format || 'Anime'}
                        </span>
                      </div>
                    </>
                  );
                  return entry.media?.id ? (
                    <Link
                      className="release-card"
                      key={entry.id}
                      to={`/watch/${entry.media.id}/${entry.episode}?language=${language}`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <a
                      className="release-card"
                      key={entry.id}
                      href={entry.providerUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${entry.title} — episode ${entry.episode} details on AnimeSchedule`}
                    >
                      {content}
                    </a>
                  );
                })}
              </div>
            ) : (
              <div className="release-empty">
                <Clock3 size={28} />
                <h3>
                  {unavailable ? 'The release feed is taking a break.' : 'You’re all caught up.'}
                </h3>
                <p>
                  {unavailable
                    ? 'We couldn’t refresh the episode feed. Try again in a moment.'
                    : `No new English ${language} episodes in the last seven days.`}
                </p>
                <button className="btn btn-subtle" onClick={home.refresh}>
                  <RotateCw size={14} /> Refresh releases
                </button>
              </div>
            )}
            <div className="release-footer">
              <span>Latest episodes · Past 7 days</span>
              <Link to="/browse/anime">
                Discover more anime <ArrowRight size={14} />
              </Link>
            </div>
          </section>
          {children}
        </div>
        <HomeSidebar popular={popular} language={language} />
      </div>
    </>
  );
}
