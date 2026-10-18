import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { useResource } from '../state';
import { Empty, ErrorNotice } from '../components';
import CoverImage from '../CoverImage';
import { languageName } from '../reader/model';
import { localDateKey, shiftDate, weekStart, weekDays } from '../../shared/schedule';

const dateLabel = (date, options) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });

function DayReleases({ category, day, language, zone, now }) {
  const [offset, setOffset] = useState(0),
    [previous, setPrevious] = useState([]);
  const pendingRetries = useRef(0);
  const query = new URLSearchParams({
    category,
    date: day,
    language,
    timezone: zone,
    offset: String(offset),
  });
  const { data, loading, error, refresh } = useResource(`/api/chapter-calendar?${query}`, false);
  useEffect(() => {
    if (data?.state !== 'pending' || pendingRetries.current >= 3) return;
    const timer = setTimeout(() => {
      pendingRetries.current++;
      refresh();
    }, 2500);
    return () => clearTimeout(timer);
  }, [data, refresh]);
  const items = [
    ...new Map([...previous, ...(data?.items || [])].map((item) => [item.id, item])).values(),
  ];
  const unavailable = data && data.state !== 'ready';
  const futureDay = day > localDateKey(now, zone);
  const timeLabel = (value) =>
    new Date(value).toLocaleTimeString(undefined, {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
    });
  return (
    <>
      <div className="schedule-day-heading" aria-live="polite">
        <h2>{dateLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        <span>
          {loading && !items.length
            ? 'Loading chapters…'
            : data?.state === 'unavailable' && !items.length
              ? 'Updates unavailable'
              : `${items.length}${data?.nextOffset !== null && data?.nextOffset !== undefined ? '+' : ''} chapters`}
        </span>
      </div>
      {error && <ErrorNotice message={error} retry={refresh} />}
      {unavailable && (
        <div className="schedule-status" role="status">
          <div>
            <strong>
              {data.state === 'stale'
                ? 'Showing saved chapter releases.'
                : data.state === 'pending'
                  ? 'Preparing this day’s releases…'
                  : 'Chapter releases are temporarily unavailable.'}
            </strong>
            <p>
              {data.state === 'stale'
                ? 'The source could not be refreshed. Some updates may be missing.'
                : 'Please try again shortly. This does not mean there were no releases.'}
            </p>
          </div>
          <button onClick={refresh}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}
      {loading && (
        <div className="section-loading" role="status" aria-label="Loading chapter releases">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="section-skeleton" key={index}>
              <span />
              <div>
                <i />
                <i />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="schedule-list reading-calendar-list">
        {items.map((item) => {
          const scheduled = Date.parse(item.publishedAt) > now;
          return (
            <article className="schedule-item" key={item.id}>
              <CoverImage media={item} alt="" className="schedule-artwork" aria-hidden="true" />
              <span className="schedule-time">
                <time dateTime={item.publishedAt}>{timeLabel(item.publishedAt)}</time>
                <small>{scheduled ? 'Scheduled' : 'Released'}</small>
              </span>
              <CoverImage media={item} alt="" className="schedule-cover" />
              <div className="chapter-calendar-details">
                <span className="eyebrow">
                  {languageName(item.language)}
                  {item.chapter ? ` · Ch. ${item.chapter}` : ' · Special'}
                </span>
                <h3>
                  {item.mediaId ? (
                    <Link to={`/title/${item.mediaId}`}>{item.title}</Link>
                  ) : (
                    <a href={item.providerUrl} target="_blank" rel="noopener noreferrer">
                      {item.title}
                    </a>
                  )}
                </h3>
                {item.chapterTitle && (
                  <span className="chapter-calendar-title">{item.chapterTitle}</span>
                )}
                <span>
                  {item.groups?.join(', ') || 'MangaDex'}
                  {scheduled ? ' · Scheduled on MangaDex' : ''}
                </span>
              </div>
              <a
                className="chapter-calendar-source"
                href={item.providerUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View ${item.title} chapter ${item.chapter || 'special'} on MangaDex`}
              >
                <ExternalLink size={16} />
              </a>
            </article>
          );
        })}
      </div>
      {!loading && !error && !unavailable && !items.length && (
        <Empty
          icon={BookOpen}
          title={futureDay ? 'No announced chapters yet.' : 'No chapter releases listed.'}
        >
          {futureDay
            ? 'Future dates appear only when the source announces them. Try today or a previous day.'
            : 'No matching releases are listed by MangaDex for this day. Try another day or All languages.'}
        </Empty>
      )}
      {data?.nextOffset != null && (
        <button
          className="btn btn-secondary chapter-calendar-more"
          disabled={loading}
          onClick={() => {
            setPrevious(items);
            setOffset(data.nextOffset);
          }}
        >
          Load more chapters
        </button>
      )}
      {data?.capped && (
        <p className="schedule-status">
          This day has more updates than the source’s paging limit. Choose English to narrow the
          list.
        </p>
      )}
      <p className="schedule-attribution">
        Chapter dates from{' '}
        <a href="https://mangadex.org" target="_blank" rel="noopener noreferrer">
          MangaDex
        </a>
        {data?.updatedAt &&
          ` · Updated ${new Date(data.updatedAt).toLocaleString(undefined, { timeZone: zone })}`}
      </p>
    </>
  );
}

export default function ReadingCalendar({ category, picker }) {
  const [zone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const today = localDateKey(now, zone),
    currentWeek = weekStart(today);
  const [week, setWeek] = useState(currentWeek),
    [day, setDay] = useState(today),
    [language, setLanguage] = useState('en');
  const days = weekDays(week);
  function changeWeek(next) {
    setWeek(next);
    setDay(next === currentWeek ? today : next);
  }
  return (
    <div className="page section-page schedule-page reading-calendar">
      <header className="section-page-heading">
        <div>
          <span className="section-kicker">
            <BookOpen size={13} /> YOUR NEXT CHAPTER
          </span>
          <h1>{category === 'manga' ? 'Manga' : 'Manhwa'} release calendar</h1>
          <p>Chapter releases and announced dates, in your local timezone.</p>
        </div>
        {picker}
      </header>
      <section className="schedule-calendar" aria-label="Choose a day and chapter language">
        <div className="schedule-toolbar">
          <div className="schedule-types" role="group" aria-label="Chapter language">
            {[
              ['en', 'English'],
              ['all', 'All languages'],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={language === value}
                onClick={() => setLanguage(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="schedule-zone">
            <Clock size={15} />
            <span>{zone.replaceAll('_', ' ')}</span>
            <small>Your local timezone</small>
          </div>
        </div>
        <div className="schedule-week">
          <button
            aria-label="Previous week"
            disabled={week <= shiftDate(currentWeek, -7)}
            onClick={() => changeWeek(shiftDate(week, -7))}
          >
            <ChevronLeft size={18} />
          </button>
          <h2>
            {dateLabel(week, { month: 'short', day: 'numeric' })} –{' '}
            {dateLabel(days[6], { month: 'short', day: 'numeric', year: 'numeric' })}
          </h2>
          <button
            aria-label="Next week"
            disabled={week >= shiftDate(currentWeek, 7)}
            onClick={() => changeWeek(shiftDate(week, 7))}
          >
            <ChevronRight size={18} />
          </button>
          <button className="schedule-today" onClick={() => changeWeek(currentWeek)}>
            Today
          </button>
        </div>
        <div className="schedule-days">
          {days.map((date) => (
            <button
              key={date}
              className={date === day ? 'active' : ''}
              aria-pressed={date === day}
              onClick={() => setDay(date)}
            >
              <span>{dateLabel(date, { weekday: 'short' })}</span>
              <strong>{dateLabel(date, { month: 'short', day: 'numeric' })}</strong>
              <small>{date === today ? 'Today' : date > today ? 'Upcoming' : 'Releases'}</small>
            </button>
          ))}
        </div>
      </section>
      <p className="chapter-calendar-coverage">
        <CalendarDays size={15} /> {category === 'manga' ? 'Japanese manga' : 'Korean manhwa'} ·
        MangaDex coverage. Dates reflect releases on this source, including translations and older
        chapters. Upcoming dates are shown only when announced.
      </p>
      <DayReleases
        key={`${category}:${day}:${language}:${zone}`}
        {...{ category, day, language, zone, now }}
      />
    </div>
  );
}
