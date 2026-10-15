import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Clock3,
  Crown,
  RotateCw,
  Sparkles,
  Star,
  TrendingUp,
} from 'lucide-react';
import { useResource } from '../state';
import { coverOf, titleOf } from '../api';
import '../discovery.css';

const tabs = [
  { value: 'new', label: 'New series', icon: Sparkles },
  { value: 'popular', label: 'Most popular', icon: Crown },
  { value: 'trending', label: 'Trending', icon: TrendingUp },
];
const periods = [
  { value: 'all', label: 'All time' },
  { value: 'year', label: 'Last year' },
  { value: 'month', label: 'Last month' },
];

export function useMangaFeed(mode, period = 'all', category = 'manga') {
  const resource = useResource(
    mode ? `/api/${category}/discovery?mode=${mode}&period=${period}` : null,
  );
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!mode) return;
    const timer = setInterval(() => {
      if (!document.hidden) resource.refresh();
    }, 120000);
    return () => clearInterval(timer);
  }, [mode, resource.refresh]);
  useEffect(() => {
    setTimedOut(false);
    if (!mode || resource.data?.state !== 'pending') return;
    const timer = setInterval(() => {
      if (!document.hidden) resource.refresh();
    }, 1500);
    const timeout = setTimeout(() => {
      clearInterval(timer);
      setTimedOut(true);
    }, 15000);
    return () => {
      clearInterval(timer);
      clearTimeout(timeout);
    };
  }, [mode, period, resource.data?.state, resource.refresh]);
  return { ...resource, timedOut };
}

function MangaCard({ media, index, mode }) {
  return (
    <Link className="release-card" to={`/title/${media.id}`}>
      <div className="release-poster">
        <img
          src={coverOf(media)}
          alt=""
          loading="lazy"
          onError={(event) => {
            if (event.currentTarget.dataset.failed) return;
            event.currentTarget.dataset.failed = '1';
            event.currentTarget.src = '/icon.svg';
          }}
        />
        {mode !== 'new' && (
          <span className="discovery-rank">
            <small>#</small>
            {String(index + 1).padStart(2, '0')}
          </span>
        )}
        <span className="release-play">
          <BookOpen size={25} />
        </span>
        <span className="release-badges">
          <span>{media.category}</span>
          {media.score > 0 && (
            <strong className="discovery-score">
              <Star size={10} fill="currentColor" />
              {Number(media.score).toFixed(1)}
            </strong>
          )}
        </span>
      </div>
      <div className="release-info">
        <h3>{titleOf(media)}</h3>
        <span>
          {mode === 'trending' ? (
            <>
              <BookOpen size={12} />
              {Number(media.viewers).toLocaleString()} {media.viewers === 1 ? 'reader' : 'readers'}{' '}
              this week
            </>
          ) : mode === 'new' && media.startDate ? (
            <time dateTime={media.startDate}>
              Started{' '}
              {new Date(media.startDate).toLocaleDateString(undefined, {
                month: 'short',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </time>
          ) : (
            <>
              {media.year || media.category}
              {media.chapters > 0 && (
                <>
                  <i>·</i>
                  {media.chapters} chapters
                </>
              )}
            </>
          )}
        </span>
      </div>
    </Link>
  );
}

export default function MangaDiscovery({ popular, category, label }) {
  const [mode, setMode] = useState('new');
  const [period, setPeriod] = useState('all');
  const refs = useRef([]);
  const activePeriod = mode === 'trending' ? 'week' : mode === 'popular' ? period : 'all';
  const usePopular = mode === 'popular' && period === 'all';
  const feed = useMangaFeed(usePopular ? null : mode, activePeriod, category);
  const resource = usePopular ? popular : feed;
  const data =
    resource.data?.mode === mode && resource.data?.period === activePeriod ? resource.data : null;
  const items = data?.items || [];
  const loading =
    !resource.error &&
    ((!data && resource.loading) || (data?.state === 'pending' && !resource.timedOut));
  const unavailable = resource.error || !data || ['pending', 'unavailable'].includes(data.state);
  const selection = `${mode}:${activePeriod}`;
  const tabKey = (event, index) => {
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
    setMode(tabs[next].value);
    refs.current[next]?.focus();
  };
  return (
    <section className="release-section discovery-section" aria-label={`Discover ${category}`}>
      <div className="release-heading discovery-heading">
        <div className="discovery-tabs" role="tablist" aria-label={`Discover ${category}`}>
          {tabs.map(({ value, label, icon: Icon }, index) => (
            <button
              key={value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              id={`${category}-tab-${value}`}
              role="tab"
              aria-selected={mode === value}
              aria-controls={`${category}-panel-${value}`}
              tabIndex={mode === value ? 0 : -1}
              className={mode === value ? 'active' : ''}
              onClick={() => setMode(value)}
              onKeyDown={(event) => tabKey(event, index)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {value === 'trending' && <small>7D</small>}
            </button>
          ))}
        </div>
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.value}
          id={`${category}-panel-${tab.value}`}
          role="tabpanel"
          aria-labelledby={`${category}-tab-${tab.value}`}
          hidden={mode !== tab.value}
          tabIndex={0}
        >
          {mode === tab.value && (
            <>
              <div className="discovery-filter-row">
                {mode === 'popular' ? (
                  <div
                    className="release-language"
                    role="group"
                    aria-label={`${label} publication period`}
                  >
                    {periods.map(({ value, label }) => (
                      <button
                        key={value}
                        className={period === value ? 'active' : ''}
                        aria-pressed={period === value}
                        onClick={() => setPeriod(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : mode === 'trending' ? (
                  <span className="discovery-week">
                    <Clock3 size={12} /> Past 7 days
                  </span>
                ) : (
                  <span className="discovery-week">
                    <Sparkles size={12} /> Fresh stories
                  </span>
                )}
                <span className="discovery-caption">
                  {mode === 'trending'
                    ? 'Most read on Yoru'
                    : data?.caption ||
                      (mode === 'new' ? `Recently published ${category} series` : '')}
                </span>
              </div>
              <div className="discovery-body" aria-busy={loading}>
                {loading ? (
                  <div className="release-grid discovery-enter" aria-label={`Loading ${category}`}>
                    {Array.from({ length: 12 }, (_, i) => (
                      <div key={i} className="release-skeleton" />
                    ))}
                  </div>
                ) : items.length ? (
                  <div key={selection} className="release-grid discovery-enter">
                    {items.map((media, index) => (
                      <div
                        className="discovery-item"
                        key={media.id}
                        style={{ '--card-delay': `${Math.min(index, 8) * 22}ms` }}
                      >
                        <MangaCard media={media} index={index} mode={mode} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div key={selection} className="release-empty discovery-enter" role="status">
                    <BookOpen size={30} />
                    <h3>
                      {unavailable
                        ? 'These stories are taking a moment.'
                        : mode === 'trending'
                          ? 'The next favorite starts with you.'
                          : 'No series found for this period.'}
                    </h3>
                    <p>
                      {unavailable
                        ? `The ${category} feed is temporarily unavailable. Your catalog is still below.`
                        : mode === 'trending'
                          ? `${label} appear here as visitors open their reading pages.`
                          : 'Try All time for more stories to discover.'}
                    </p>
                    {unavailable ? (
                      <button className="btn btn-subtle" onClick={resource.refresh}>
                        <RotateCw size={14} /> Try again
                      </button>
                    ) : (
                      <a className="btn btn-subtle" href={`#${category}-catalog`}>
                        Explore the collection <ArrowRight size={14} />
                      </a>
                    )}
                  </div>
                )}
              </div>
              <div className="release-footer">
                <span>
                  {data?.state === 'stale' ? 'Latest saved picks · ' : ''}
                  {mode === 'trending'
                    ? 'Unique reading-page visitors · Past 7 days'
                    : mode === 'new'
                      ? 'Series publication dates · Kitsu'
                      : 'Ranked by Kitsu readers'}
                </span>
                <a href={`#${category}-catalog`}>
                  Browse all {category} <ArrowRight size={13} />
                </a>
              </div>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
