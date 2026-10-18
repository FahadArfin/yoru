import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Crown,
  Eye,
  Maximize2,
  Play,
  RotateCw,
  Sparkles,
  Star,
  TrendingUp,
} from 'lucide-react';
import { useResource } from '../state';
import { ago, coverOf } from '../api';
import CoverImage from '../CoverImage';
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

function PreviewCard({ item, mode, index }) {
  const released = mode === 'released';
  const media = released ? { ...item.media, cover: item.cover || coverOf(item.media) } : item;
  const body = (
    <>
      <CoverImage
        className="discovery-preview-art"
        media={{
          ...media,
          cover: item.banner || media.banner || media.cover,
          coverAlternates: [media.cover, ...(media.coverAlternates || [])],
        }}
      />
      {index > 0 && <CoverImage className="discovery-preview-cover" media={media} />}
      <div className="discovery-preview-copy">
        <span className="discovery-preview-number">
          {released ? `EP ${item.episode}` : `#${String(index + 1).padStart(2, '0')}`}
        </span>
        <strong>{item.title}</strong>
        <small>
          {released
            ? `${item.airType === 'dub' ? 'ENG DUB' : item.airType === 'sub' ? 'SUB' : 'CHINESE'} · ${ago(item.airingAt)}`
            : mode === 'trending'
              ? `${Number(item.viewers).toLocaleString()} ${item.viewers === 1 ? 'viewer' : 'viewers'} this week`
              : `${item.format || 'Anime'}${item.year ? ` · ${item.year}` : ''}${item.score > 0 ? ` · ★ ${Number(item.score).toFixed(1)}` : ''}`}
        </small>
      </div>
    </>
  );
  const route = released
    ? item.media?.id && ['sub', 'dub'].includes(item.airType)
      ? `/watch/${item.media.id}/${item.episode}?language=${item.airType}`
      : null
    : item.id
      ? `/title/${item.id}`
      : null;
  const className = `discovery-preview-card ${index === 0 ? 'is-featured' : ''}`;
  return route ? (
    <Link className={className} to={route}>
      {body}
    </Link>
  ) : (
    <a className={className} href={item.providerUrl} target="_blank" rel="noreferrer">
      {body}
    </a>
  );
}

function DiscoveryPanel({ mode, expanded, onExpand, home, language, onLanguage }) {
  const [period, setPeriod] = useState('all');
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
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
  }, [mode, ranked.refresh]);
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
  // Never show a previous filter's response under a new label.
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
  const Icon = active.icon;
  const selection = `${mode}:${mode === 'released' ? language : period}:${expanded}`;
  return (
    <section
      className={`discovery-panel ${expanded ? 'is-expanded' : 'is-compact'}`}
      aria-label={active.label}
    >
      <header className="discovery-category-heading">
        <h2>
          <button
            id={`discovery-toggle-${mode}`}
            aria-expanded={expanded}
            aria-controls={`discovery-content-${mode}`}
            onClick={onExpand}
            aria-label={active.label}
          >
            <Icon size={16} />
            <span>{active.label}</span>
            <Maximize2 className="discovery-expand-icon" size={14} />
          </button>
        </h2>
        <span className="discovery-category-hint">
          {expanded ? 'Expanded collection' : 'Click heading to expand'}
        </span>
      </header>
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
          <div className="release-language" role="group" aria-label="Popularity release period">
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
        ) : (
          <span className="discovery-week">
            <Clock3 size={12} /> Last week <span>· On Yoru</span>
          </span>
        )}
      </div>
      {expanded && mode === 'popular' && data?.caption && (
        <p className="discovery-caption">{data.caption}</p>
      )}
      <div id={`discovery-content-${mode}`} className="discovery-body" aria-busy={loading}>
        {loading ? (
          <div
            className={expanded ? 'release-grid' : 'discovery-preview-list'}
            aria-label={`Loading ${active.label.toLowerCase()}`}
          >
            {Array.from({ length: expanded ? 12 : 5 }, (_, i) => (
              <div key={i} className="release-skeleton" />
            ))}
          </div>
        ) : items.length ? (
          expanded ? (
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
            <div key={selection} className="discovery-preview-list discovery-enter">
              {items.slice(0, 5).map((item, index) => (
                <PreviewCard key={item.id || item.route} item={item} mode={mode} index={index} />
              ))}
            </div>
          )
        ) : (
          <div key={selection} className="release-empty discovery-enter" role="status">
            {mode === 'trending' ? <TrendingUp size={28} /> : <Clock3 size={28} />}
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
      <footer className="discovery-panel-footer">
        <span>
          {mode === 'released' ? (
            'Latest episodes · Past 7 days'
          ) : mode === 'trending' ? (
            'Unique visitors · Past 7 days'
          ) : (
            <>
              {data?.state === 'stale' ? 'Saved ranking' : 'Popularity'} ·{' '}
              <a href="https://animeschedule.net/" target="_blank" rel="noreferrer">
                AnimeSchedule
              </a>
            </>
          )}
        </span>
        {!expanded ? (
          <button onClick={onExpand}>
            Expand collection <ArrowRight size={13} />
          </button>
        ) : mode === 'released' ? (
          <Link to="/schedule">
            <CalendarDays size={13} /> Full schedule
          </Link>
        ) : (
          <Link to="/browse/anime">
            Discover more <ArrowRight size={13} />
          </Link>
        )}
      </footer>
    </section>
  );
}

export default function HomeDiscovery({ home, language, onLanguage }) {
  const [mode, setMode] = useState('released');
  return (
    <div className="release-section discovery-section">
      <div className="discovery-mobile-switcher" role="group" aria-label="Choose expanded category">
        {tabs.map(({ value, label }) => (
          <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
            {label}
          </button>
        ))}
      </div>
      <div
        className="discovery-panels"
        style={{
          '--discovery-columns': tabs
            .map((tab) => (tab.value === mode ? 'minmax(0, 2.6fr)' : 'minmax(0, 1fr)'))
            .join(' '),
        }}
      >
        {tabs.map((tab) => (
          <DiscoveryPanel
            key={tab.value}
            mode={tab.value}
            expanded={mode === tab.value}
            onExpand={() => setMode(tab.value)}
            home={home}
            language={language}
            onLanguage={onLanguage}
          />
        ))}
      </div>
    </div>
  );
}
