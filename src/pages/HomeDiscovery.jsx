import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Crown,
  Eye,
  Play,
  RotateCw,
  Sparkles,
  Star,
  TrendingUp,
} from 'lucide-react';
import { useResource } from '../state';
import { ago, coverOf } from '../api';
import '../discovery.css';

const tabs = [
  { value: 'released', label: 'Just released', icon: Sparkles },
  { value: 'popular', label: 'Most popular', icon: Crown },
  { value: 'trending', label: 'Trending', icon: TrendingUp },
];
const releaseFilters = [
  {
    value: 'all',
    label: 'All',
    name: 'All releases',
    empty: 'No new episodes in the last seven days.',
  },
  {
    value: 'sub',
    label: 'Sub',
    name: 'English sub',
    empty: 'No new English sub episodes in the last seven days.',
  },
  {
    value: 'dub',
    label: 'Dub',
    name: 'English dub',
    empty: 'No new English dub episodes in the last seven days.',
  },
  {
    value: 'chinese',
    label: 'Chinese',
    name: 'Chinese releases',
    empty: 'No new Chinese episodes in the last seven days.',
  },
];
const periods = [
  { value: 'all', label: 'All time' },
  { value: 'year', label: 'Last year' },
  { value: 'month', label: 'Last month' },
];
const fallbackImage = (event) => {
  if (event.currentTarget.dataset.failed) return;
  event.currentTarget.dataset.failed = '1';
  event.currentTarget.src = '/icon.svg';
};

function ReleaseCard({ entry }) {
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
          <span>
            {entry.airType === 'dub' ? 'ENG DUB' : entry.airType === 'sub' ? 'SUB' : 'CHINESE'}
          </span>
          <strong>EP {entry.episode}</strong>
        </span>
      </div>
      <div className="release-info">
        <h3>{entry.title}</h3>
        <span>
          <Clock3 size={11} />
          <time dateTime={entry.airingAt} title={new Date(entry.airingAt).toLocaleString()}>
            {ago(entry.airingAt)}
          </time>
          <i>·</i>
          {entry.media?.format || 'Anime'}
        </span>
      </div>
    </>
  );
  return entry.media?.id && ['sub', 'dub'].includes(entry.airType) ? (
    <Link
      className="release-card"
      to={`/watch/${entry.media.id}/${entry.episode}?language=${entry.airType}`}
    >
      {content}
    </Link>
  ) : (
    <a
      className="release-card"
      href={entry.providerUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`${entry.title} — episode ${entry.episode} details on AnimeSchedule`}
    >
      {content}
    </a>
  );
}

function RankedCard({ media, index, trending }) {
  const content = (
    <>
      <div className="release-poster">
        <img src={coverOf(media)} alt="" loading="lazy" onError={fallbackImage} />
        <span className="discovery-rank">
          <small>#</small>
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="release-play">
          <ArrowRight size={25} />
        </span>
        <span className="release-badges">
          <span>{media.format || 'Anime'}</span>
          {media.score > 0 && (
            <strong className="discovery-score">
              <Star size={10} fill="currentColor" />
              {Number(media.score).toFixed(1)}
            </strong>
          )}
        </span>
      </div>
      <div className="release-info">
        <h3>{media.title}</h3>
        <span>
          {trending ? (
            <>
              <Eye size={12} />
              {Number(media.viewers).toLocaleString()} {media.viewers === 1 ? 'viewer' : 'viewers'}{' '}
              this week
            </>
          ) : (
            <>
              {media.year || 'Anime'}
              {media.episodes > 0 && (
                <>
                  <i>·</i>
                  {media.episodes} episodes
                </>
              )}
            </>
          )}
        </span>
      </div>
    </>
  );
  return media.id ? (
    <Link className="release-card" to={`/title/${media.id}`}>
      {content}
    </Link>
  ) : (
    <a className="release-card" href={media.providerUrl} target="_blank" rel="noreferrer">
      {content}
    </a>
  );
}

export default function HomeDiscovery({ home, language, onLanguage }) {
  const [mode, setMode] = useState('released');
  const [period, setPeriod] = useState('all');
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const tabRefs = useRef([]);
  const ranked = useResource(
    mode === 'released'
      ? null
      : `/api/home/discovery?mode=${mode}&period=${mode === 'trending' ? 'week' : period}`,
  );
  useEffect(() => {
    if (mode === 'released') return;
    const timer = setInterval(() => {
      if (!document.hidden) ranked.refresh();
    }, 120000);
    return () => clearInterval(timer);
  }, [mode]);
  useEffect(() => {
    setPendingTimedOut(false);
    if (mode === 'released' || ranked.data?.state !== 'pending') return;
    const poll = setInterval(() => {
      if (!document.hidden) ranked.refresh();
    }, 1500);
    const timeout = setTimeout(() => {
      clearInterval(poll);
      setPendingTimedOut(true);
    }, 15000);
    return () => {
      clearInterval(poll);
      clearTimeout(timeout);
    };
  }, [mode, period, ranked.data?.state, ranked.refresh]);
  const resource = mode === 'released' ? home : ranked;
  // A previous filter's response must never appear under a newly selected label.
  const data =
    mode === 'released'
      ? !home.data?.language || home.data.language === language
        ? home.data
        : null
      : ranked.data?.mode === mode &&
          ranked.data?.period === (mode === 'trending' ? 'week' : period)
        ? ranked.data
        : null;
  const items = (mode === 'released' ? data?.releases : data?.items) || [];
  const loading = (!data || (data.state === 'pending' && !pendingTimedOut)) && !resource.error;
  const unavailable =
    resource.error ||
    (data?.state === 'pending' && pendingTimedOut) ||
    ['not-configured', 'unavailable', 'partial'].includes(data?.state) ||
    (data?.stale && !items.length);
  const active = tabs.find((tab) => tab.value === mode);
  const selection = `${mode}:${mode === 'released' ? language : period}`;
  const tabKey = (event, index) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setMode(tabs[next].value);
    tabRefs.current[next]?.focus();
  };
  return (
    <section className="release-section discovery-section" aria-label={active.label}>
      <h2 className="sr-only">{active.label}</h2>
      <div className="release-heading discovery-heading">
        <div className="discovery-tabs" role="tablist" aria-label="Discover anime">
          {tabs.map(({ value, label, icon: Icon }, index) => (
            <button
              key={value}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`discovery-tab-${value}`}
              role="tab"
              aria-selected={mode === value}
              aria-controls={`discovery-panel-${value}`}
              tabIndex={mode === value ? 0 : -1}
              onClick={() => setMode(value)}
              onKeyDown={(event) => tabKey(event, index)}
              className={mode === value ? 'active' : ''}
            >
              <Icon size={17} />
              <span>{label}</span>
              {value === 'trending' && <small>7D</small>}
            </button>
          ))}
        </div>
        {mode === 'released' && (
          <Link className="release-schedule" to="/schedule">
            <CalendarDays size={14} /> Full schedule <ArrowRight size={14} />
          </Link>
        )}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.value}
          id={`discovery-panel-${tab.value}`}
          role="tabpanel"
          aria-labelledby={`discovery-tab-${tab.value}`}
          hidden={mode !== tab.value}
          tabIndex={0}
        >
          {mode === tab.value && (
            <>
              <div className="discovery-filter-row">
                {mode === 'released' ? (
                  <div className="release-language" role="group" aria-label="Release filter">
                    {releaseFilters.map(({ value, label, name }) => (
                      <button
                        key={value}
                        aria-label={name}
                        title={name}
                        aria-pressed={language === value}
                        className={language === value ? 'active' : ''}
                        onClick={() => onLanguage(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : mode === 'popular' ? (
                  <>
                    <div
                      className="release-language"
                      role="group"
                      aria-label="Popularity release period"
                    >
                      {periods.map(({ value, label }) => (
                        <button
                          key={value}
                          aria-pressed={period === value}
                          className={period === value ? 'active' : ''}
                          onClick={() => setPeriod(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <span className="discovery-caption">{data?.caption}</span>
                  </>
                ) : (
                  <>
                    <span className="discovery-week">
                      <Clock3 size={12} /> Last week
                    </span>
                    <span className="discovery-caption">Most viewed on Yoru</span>
                  </>
                )}
              </div>
              <div className="discovery-body" aria-busy={loading}>
                {loading ? (
                  <div
                    key={`${selection}:loading`}
                    className="release-grid discovery-enter"
                    aria-label="Loading anime"
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <div key={i} className="release-skeleton" />
                    ))}
                  </div>
                ) : items.length ? (
                  <div key={selection} className="release-grid discovery-enter">
                    {items.map((item, index) => (
                      <div
                        className="discovery-item"
                        style={{ '--card-delay': `${Math.min(index, 8) * 22}ms` }}
                        key={item.id || item.route}
                      >
                        {mode === 'released' ? (
                          <ReleaseCard entry={item} />
                        ) : (
                          <RankedCard media={item} index={index} trending={mode === 'trending'} />
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div key={selection} className="release-empty discovery-enter" role="status">
                    {mode === 'trending' ? <TrendingUp size={30} /> : <Clock3 size={28} />}
                    <h3>
                      {unavailable
                        ? mode === 'released'
                          ? 'The release feed is taking a break.'
                          : 'These picks are taking a break.'
                        : mode === 'trending'
                          ? 'Be the first to start a trend.'
                          : mode === 'released'
                            ? 'You’re all caught up.'
                            : 'No premieres found for this period.'}
                    </h3>
                    <p>
                      {unavailable
                        ? 'We couldn’t refresh these anime. Try again in a moment.'
                        : mode === 'released'
                          ? releaseFilters.find((x) => x.value === language).empty
                          : mode === 'trending'
                            ? 'Anime will appear here as people visit their watch pages.'
                            : 'Try All time for more anime to discover.'}
                    </p>
                    {mode === 'trending' && !unavailable ? (
                      <Link className="btn btn-subtle" to="/browse/anime">
                        Find your next anime <ArrowRight size={14} />
                      </Link>
                    ) : (
                      <button className="btn btn-subtle" onClick={resource.refresh}>
                        <RotateCw size={14} />
                        {mode === 'released' ? 'Refresh releases' : 'Try again'}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="release-footer">
                <span>
                  {mode === 'released' ? (
                    'Latest episodes · Past 7 days'
                  ) : mode === 'trending' ? (
                    'Unique watch-page visitors · Past 7 days'
                  ) : (
                    <>
                      {data?.state === 'stale' ? 'Saved ranking · ' : 'Popularity · '}
                      <a href="https://animeschedule.net/" target="_blank" rel="noreferrer">
                        AnimeSchedule
                      </a>
                    </>
                  )}
                </span>
                <Link to="/browse/anime">
                  Discover more anime <ArrowRight size={14} />
                </Link>
              </div>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
