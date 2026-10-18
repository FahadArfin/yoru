import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  ChevronDown,
  Clock3,
  MessageSquare,
  Star,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { useApp, useResource } from '../state';
import { ago, bannerOf, coverOf, itemsOf, titleOf } from '../api';
import { Avatar } from '../components';
import { airingLabel, localDateKey, weekDays, weekStart } from '../../shared/schedule';

function MediaRow({ media, upcoming = false }) {
  const body = (
    <>
      <img className="rail-backdrop" src={bannerOf(media)} alt="" loading="lazy" />
      <img className="rail-poster" src={coverOf(media)} alt="" loading="lazy" />
      <div className="rail-row-copy">
        <strong>
          <span className={`rail-status ${upcoming ? 'is-upcoming' : ''}`} />
          {titleOf(media)}
        </strong>
        <span className="rail-meta">
          {media.format || 'TV'} {media.year && <span>· {media.year}</span>}
          {media.score > 0 && (
            <span className="rail-score">
              <Star size={11} fill="currentColor" />
              {Number(media.score).toFixed(1)}
            </span>
          )}
        </span>
        {media.viewers > 0 && (
          <small>
            {media.viewers} {media.viewers === 1 ? 'viewer' : 'viewers'}
          </small>
        )}
      </div>
    </>
  );
  return media.id ? (
    <Link className="rail-media-row" to={`/title/${media.id}`}>
      {body}
    </Link>
  ) : (
    <a className="rail-media-row" href={media.providerUrl} target="_blank" rel="noreferrer">
      {body}
    </a>
  );
}
export function HomeAiringSchedule({ language }) {
  const [now, setNow] = useState(Date.now());
  const today = localDateKey(now);
  const [selected, setSelected] = useState(null);
  const day = selected || today;
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(false);
  const start = weekStart(today);
  const calendar = useResource(`/api/calendar?week=${start}`);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) calendar.refresh();
    }, 120000);
    return () => clearInterval(timer);
  }, [start]);
  useEffect(() => {
    setSelected(null);
    setExpanded(false);
  }, [start]);
  const items = (calendar.data?.items || [])
    .filter((x) => x.airType === language && x.airingAt && localDateKey(x.airingAt) === day)
    .filter(
      (x) =>
        filter === 'all' ||
        (filter === 'aired'
          ? !x.delayed && Date.parse(x.airingAt) <= now
          : x.delayed || Date.parse(x.airingAt) > now),
    )
    .sort((a, b) => Date.parse(a.airingAt) - Date.parse(b.airingAt));
  const timezone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${day}T12:00:00`))
    .find((x) => x.type === 'timeZoneName')?.value;
  return (
    <section
      className="home-rail-panel rail-schedule home-airing-schedule"
      aria-label="Airing schedule"
    >
      <div className="rail-heading">
        <h2>
          <CalendarDays size={14} /> Airing schedule
        </h2>
        <small title={Intl.DateTimeFormat().resolvedOptions().timeZone}>{timezone}</small>
      </div>
      <div className="rail-days" aria-label="Schedule day">
        {weekDays(start).map((date) => (
          <button
            key={date}
            aria-pressed={date === day}
            onClick={() => {
              setSelected(date);
              setExpanded(false);
            }}
          >
            {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}
            <small>
              {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </small>
          </button>
        ))}
      </div>
      <div className="rail-filters">
        <div>
          {['all', 'upcoming', 'aired'].map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setExpanded(false);
              }}
            >
              {value}
            </button>
          ))}
        </div>
        <small>
          {items.length} airing · {language}
        </small>
      </div>
      {calendar.data?.stale && <p className="rail-note">Showing the latest saved schedule.</p>}
      <div className="rail-schedule-list">
        {items.slice(0, expanded ? items.length : 6).map((item) => (
          <a
            className="rail-media-row schedule-row"
            key={item.id}
            href={item.providerUrl}
            target="_blank"
            rel="noreferrer"
          >
            <img className="rail-backdrop" src={item.cover} alt="" loading="lazy" />
            <img className="rail-poster" src={item.cover} alt="" loading="lazy" />
            <div className="rail-row-copy">
              <strong>{item.title}</strong>
              <span className="rail-meta">
                <Clock3 size={10} />
                <time dateTime={item.airingAt}>
                  {new Date(item.airingAt).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                <b>EP {item.episode || 'TBA'}</b>
                <span>{airingLabel(item, now)}</span>
              </span>
            </div>
          </a>
        ))}
      </div>
      {!items.length && (
        <p className="rail-empty">
          {calendar.loading
            ? 'Loading today’s schedule…'
            : calendar.error || ['unavailable', 'not-configured'].includes(calendar.data?.state)
              ? 'Schedule temporarily unavailable.'
              : 'No episodes in this selection.'}
        </p>
      )}
      <div className="home-airing-footer">
        {items.length > 6 && (
          <button className="rail-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : `Show more (${items.length - 6} more)`}
            <ChevronDown size={12} />
          </button>
        )}
        <Link className="rail-more" to="/schedule">
          Full airing schedule
        </Link>
      </div>
    </section>
  );
}
export default function HomeSidebar({ popular = [] }) {
  const sidebar = useResource('/api/home/sidebar');
  const community = useResource('/api/community', false);
  const { event } = useApp();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (['comments', 'reviews', 'snapshot'].includes(event?.type)) community.refresh();
    if (['library', 'snapshot'].includes(event?.type)) sidebar.refresh();
  }, [event]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) sidebar.refresh();
    }, 300000);
    return () => clearInterval(timer);
  }, []);
  const viewed = sidebar.data?.mostViewed || [];
  const upcoming = sidebar.data?.upcoming || [];
  return (
    <aside className="home-right-rail" aria-label="Anime highlights">
      <section className="home-rail-panel" aria-label="Most viewed">
        <div className="rail-heading">
          <h2>
            <TrendingUp size={14} /> Most viewed
          </h2>
        </div>
        <p className="rail-note">
          {viewed.length ? 'By watched Yoru libraries' : 'Popular picks · AnimeSchedule'}
        </p>
        {(viewed.length ? viewed : popular).slice(0, 4).map((media) => (
          <MediaRow key={media.id || media.route} media={media} />
        ))}
        {!viewed.length && (
          <p className="rail-note rail-footnote">
            {sidebar.error
              ? 'Viewer rankings are temporarily unavailable.'
              : 'Viewer rankings appear as members log episodes.'}
          </p>
        )}
      </section>
      <section className="home-rail-panel" aria-label="Upcoming anime">
        <div className="rail-heading">
          <h2>
            <Trophy size={14} /> Upcoming
          </h2>
        </div>
        {sidebar.data?.stale && <p className="rail-note">Latest saved upcoming titles</p>}
        {upcoming.slice(0, expanded ? 8 : 5).map((media) => (
          <MediaRow key={media.id || media.route} media={media} upcoming />
        ))}
        {!upcoming.length && (
          <p className="rail-empty">
            {sidebar.loading
              ? 'Loading upcoming anime…'
              : 'Upcoming titles are temporarily unavailable.'}
          </p>
        )}
        {upcoming.length > 5 && (
          <button className="rail-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : 'Show more'}
            <ChevronDown size={12} />
          </button>
        )}
      </section>
      <section className="home-rail-panel" aria-label="Community">
        <div className="rail-heading">
          <h2>
            <MessageSquare size={14} /> Community
          </h2>
          <Link to="/community">View all →</Link>
        </div>
        {itemsOf(community.data)
          .slice(0, 8)
          .map((item) => (
            <Link
              key={item.id}
              className="rail-post"
              to={`/title/${item.mediaId}${item.kind === 'review' ? '?tab=reviews' : item.unit ? `?unit=${item.unit}` : ''}`}
            >
              <Avatar
                user={item.author || item.user || { name: item.userName || item.name }}
                size="small"
              />
              <div>
                <span>
                  <b>
                    {item.author?.name || item.user?.name || item.userName || item.name || 'Member'}
                  </b>
                  <time>{ago(item.createdAt)}</time>
                </span>
                <p>
                  {item.spoiler
                    ? 'Spoiler discussion — open to reveal'
                    : item.title || item.body?.slice(0, 100)}
                </p>
                <small>{item.kind === 'review' ? 'Review' : 'Discussion'}</small>
              </div>
            </Link>
          ))}
        {!itemsOf(community.data).length && (
          <div className="rail-empty">
            <MessageSquare size={25} />
            <p>
              {community.error
                ? 'Conversations are temporarily unavailable.'
                : 'Your next favorite starts with a conversation.'}
            </p>
            <Link to="/community">Join the community →</Link>
          </div>
        )}
      </section>
    </aside>
  );
}
