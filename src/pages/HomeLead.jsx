import React, { useEffect, useState } from 'react';
import HomeSidebar, { HomeAiringSchedule } from './HomeSidebar';
import HomeDiscovery from './HomeDiscovery';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Flame, Play, Plus } from 'lucide-react';
import { useApp, useResource } from '../state';
import { titleOf } from '../api';
import { useBannerArtwork } from '../useBannerArtwork';

export default function HomeLead({ children }) {
  const [language, setLanguage] = useState('all');
  const home = useResource(`/api/home?language=${language}`);
  const [failedLogo, setFailedLogo] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [, tick] = useState(0);
  const { entryFor, updateEntry } = useApp();
  const [popular, setPopular] = useState([]);
  useEffect(() => {
    if (home.data?.hot) setPopular(home.data.hot);
  }, [home.data]);
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
  const unavailable =
    home.error ||
    ['not-configured', 'unavailable', 'partial'].includes(home.data?.state) ||
    (home.data?.stale && !releases.length);
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
            <span className="weekly-caption" title={home.data?.ranking}>
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
      <div className="home-content-layout home-width home-discovery-layout">
        <div className="home-release-column">
          <HomeDiscovery home={home} language={language} onLanguage={setLanguage} />
          <HomeAiringSchedule language={language === 'dub' ? 'dub' : 'sub'} />
          {children}
        </div>
        <div className="home-lower-highlights">
          <HomeSidebar popular={popular} />
        </div>
      </div>
    </>
  );
}
