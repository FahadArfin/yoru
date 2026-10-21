import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from '../collection-router';
import {
  ArrowRight,
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
import { MangaCard } from './MangaDiscovery';
import '../discovery.css';
import ReaderCatalog from '../reader/ReaderCatalog';
import { useReaderSelection } from '../useCatalogPreferences';

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
  { value: 'month', label: 'Last month' },
  { value: 'year', label: 'Last year' },
  { value: 'all', label: 'All time' },
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
    <Link
      className="release-card"
      to={trending ? `/watch/${media.id}/latest` : `/title/${media.id}`}
    >
      {content}
    </Link>
  ) : (
    <a className="release-card" href={media.providerUrl} target="_blank" rel="noreferrer">
      {content}
    </a>
  );
}

function PreviewCard({ item, mode, index, reading }) {
  const released = mode === 'released' && !reading;
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
              ? `${Number(item.viewers).toLocaleString()} ${reading ? (item.viewers === 1 ? 'reader' : 'readers') : item.viewers === 1 ? 'viewer' : 'viewers'} this week`
              : `${item.format || item.category || (reading ? 'Manga' : 'Anime')}${item.year ? ` · ${item.year}` : ''}${item.score > 0 ? ` · ★ ${Number(item.score).toFixed(1)}` : ''}`}
        </small>
      </div>
    </>
  );
  const route = released
    ? item.media?.id && ['sub', 'dub'].includes(item.airType)
      ? `/watch/${item.media.id}/${item.episode}?language=${item.airType}`
      : null
    : item.id
      ? !reading && mode === 'trending'
        ? `/watch/${item.id}/latest`
        : `/title/${item.id}`
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

function DiscoveryPanel({ mode, expanded, onExpand, home, language, onLanguage, category }) {
  const reading = category !== 'anime';
  const animeReleases = !reading && mode === 'released';
  const feedMode = reading && mode === 'released' ? 'new' : mode;
  const [period, setPeriod] = useState(mode === 'popular' ? 'month' : 'all');
  const feedPeriod = mode === 'trending' ? 'week' : period;
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const ranked = useResource(
    animeReleases
      ? null
      : `/api/${reading ? category : 'home'}/discovery?mode=${feedMode}&period=${feedPeriod}`,
  );
  useEffect(() => {
    if (animeReleases) return;
    const timer = setInterval(() => {
      if (!document.hidden) ranked.refresh();
    }, 120000);
    return () => clearInterval(timer);
  }, [animeReleases, ranked.refresh]);
  useEffect(() => {
    setPendingTimedOut(false);
    if (animeReleases || ranked.data?.state !== 'pending') return;
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
  }, [animeReleases, period, ranked.data?.state, ranked.refresh]);
  const resource = animeReleases ? home : ranked;
  // Never show a previous filter's response under a new label.
  const data = animeReleases
    ? !home.data?.language || home.data.language === language
      ? home.data
      : null
    : ranked.data?.mode === feedMode && ranked.data?.period === feedPeriod
      ? ranked.data
      : null;
  const feedItems = (animeReleases ? data?.releases : data?.items) || [];
  const items = mode === 'trending' ? feedItems.slice(0, 10) : feedItems;
  const loading = (!data || (data.state === 'pending' && !pendingTimedOut)) && !resource.error;
  const unavailable =
    resource.error ||
    (data?.state === 'pending' && pendingTimedOut) ||
    ['not-configured', 'unavailable', 'partial'].includes(data?.state) ||
    (data?.stale && !items.length);
  const active = { ...tabs.find((tab) => tab.value === mode) };
  if (reading && mode === 'released') active.label = 'New series';
  const Icon = active.icon;
  const selection = `${mode}:${mode === 'released' ? language : period}:${expanded}`;
  return (
    <section
      className={`discovery-panel ${expanded ? 'is-expanded' : 'is-compact'}`}
      aria-label={active.label}
      data-category={mode}
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
            {expanded && <Maximize2 className="discovery-expand-icon" size={14} />}
          </button>
        </h2>
      </header>
      {mode !== 'trending' && (mode !== 'popular' || expanded) && (
        <div className="discovery-filter-row">
          {animeReleases ? (
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
          ) : reading && mode === 'released' ? (
            <span className="discovery-week">
              <Sparkles size={12} /> New {category} series
            </span>
          ) : mode === 'popular' ? (
            <div className="release-language" role="group" aria-label="Popularity release period">
              <button
                className="active popularity-cycle"
                title="Cycle popularity period: Last month, Last year, All time"
                onClick={() =>
                  setPeriod(
                    (current) =>
                      periods[
                        (periods.findIndex((item) => item.value === current) + 1) % periods.length
                      ].value,
                  )
                }
              >
                <span aria-live="polite">
                  {periods.find((item) => item.value === period)?.label}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      )}
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
                  {reading ? (
                    <MangaCard media={item} index={index} mode={feedMode} />
                  ) : mode === 'released' ? (
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
                <PreviewCard
                  key={item.id || item.route}
                  item={item}
                  mode={mode}
                  index={index}
                  reading={reading}
                />
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
                    ? reading
                      ? 'No new series found.'
                      : 'You’re all caught up.'
                    : 'No premieres found for this period.'}
            </h3>
            <p>
              {unavailable
                ? `We couldn’t refresh these ${reading ? 'stories' : 'anime'}. Try again in a moment.`
                : animeReleases
                  ? releaseFilters.find((x) => x.value === language).empty
                  : mode === 'trending'
                    ? `${reading ? 'Stories' : 'Anime'} will appear here as people visit their ${reading ? 'reading' : 'watch'} pages.`
                    : `Explore the ${category} collection for more stories.`}
            </p>
            {mode === 'trending' && !unavailable ? (
              <Link className="btn btn-subtle" to={`/browse/${category}`}>
                Find your next {category} <ArrowRight size={14} />
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
    </section>
  );
}

export default function HomeDiscovery(props) {
  const selection = useReaderSelection();
  const reading = props.category && props.category !== 'anime';
  const coreAllowed =
    !reading || (selection?.ready && selection.context.integrationMode !== 'extensions');
  return (
    <>
      {reading && <ReaderCatalog category={props.category} />}
      {coreAllowed && <CoreHomeDiscovery {...props} />}
    </>
  );
}
function CoreHomeDiscovery({ home, language, onLanguage, category = 'anime' }) {
  const [mode, setMode] = useState('released');
  const panelsRef = useRef(null);
  const previousBounds = useRef(null);
  const motion = useRef([]);
  const selectMode = (nextMode) => {
    if (nextMode === mode) return;
    // Capture the visible position even if another selection is still moving.
    previousBounds.current = new Map(
      Array.from(panelsRef.current.children, (panel) => [
        panel.dataset.category,
        panel.getBoundingClientRect(),
      ]),
    );
    motion.current.forEach((animation) => animation.cancel());
    setMode(nextMode);
  };
  useLayoutEffect(() => {
    const before = previousBounds.current;
    previousBounds.current = null;
    if (
      !before ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.reduceMotion === 'true'
    )
      return;
    // Move the same keyed panels, preserving their filters and loaded feeds.
    // Animate width rather than scale so the lettering and artwork stay sharp.
    motion.current = Array.from(panelsRef.current.children, (panel) => {
      const old = before.get(panel.dataset.category);
      const next = panel.getBoundingClientRect();
      return panel.animate(
        [
          {
            transform: `translate(${old.x - next.x}px, ${old.y - next.y}px)`,
            width: `${old.width}px`,
          },
          { transform: 'translate(0, 0)', width: `${next.width}px` },
        ],
        { duration: 620, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    });
    return () => motion.current.forEach((animation) => animation.cancel());
  }, [mode]);
  const categories = tabs.map((tab) => ({
    ...tab,
    label: category !== 'anime' && tab.value === 'released' ? 'New series' : tab.label,
  }));
  const orderedCategories = [
    categories.find((tab) => tab.value === mode),
    ...categories.filter((tab) => tab.value !== mode),
  ];
  return (
    <div className="release-section discovery-section">
      <div className="discovery-mobile-switcher" role="group" aria-label="Choose expanded category">
        {categories.map(({ value, label }) => (
          <button key={value} aria-pressed={mode === value} onClick={() => selectMode(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className="discovery-panels" ref={panelsRef}>
        {orderedCategories.map((tab) => (
          <DiscoveryPanel
            key={tab.value}
            mode={tab.value}
            expanded={mode === tab.value}
            onExpand={() => selectMode(tab.value)}
            home={home}
            language={language}
            onLanguage={onLanguage}
            category={category}
          />
        ))}
      </div>
    </div>
  );
}
