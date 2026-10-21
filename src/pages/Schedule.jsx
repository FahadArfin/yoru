import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReadingCalendar from './ReadingCalendar';
import usePhoneDayStrip from '../usePhoneDayStrip';
import {
  CalendarDays,
  Clock,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { useResource } from '../state';
import { Empty, ErrorNotice } from '../components';
import CoverImage from '../CoverImage';
import '../section-pages.css';
import { localDateKey, shiftDate, weekStart, weekDays, airingLabel } from '../../shared/schedule';
import { animationCategories, scheduleCategory } from '../../shared/schedule-category';
const types = { raw: 'Broadcast', sub: 'English sub', dub: 'English dub' };
export default function Schedule() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('category') || params.get('format');
  const category = ['manga', 'manhwa'].includes(requested) ? requested : 'anime';
  const picker = (
    <div className="schedule-categories" role="group" aria-label="Schedule category">
      {['anime', 'manga', 'manhwa'].map((value) => (
        <button
          key={value}
          aria-pressed={category === value}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.delete('format');
            if (value === 'anime') next.delete('category');
            else next.set('category', value);
            setParams(next);
          }}
        >
          {value === 'manhwa' ? 'Manhwa' : value === 'manga' ? 'Manga' : 'Anime'}
        </button>
      ))}
    </div>
  );
  return category === 'anime' ? (
    <AnimeSchedule picker={picker} />
  ) : (
    <ReadingCalendar category={category} picker={picker} />
  );
}
function AnimeSchedule({ picker }) {
  const [params, setParams] = useSearchParams();
  const requestedAnimation = params.get('animation');
  const animation = Object.hasOwn(animationCategories, requestedAnimation)
    ? requestedAnimation
    : 'japanese';
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
    [type, setType] = useState('raw');
  const phoneDays = usePhoneDayStrip(day);
  const { data, loading, error, refresh } = useResource(`/api/calendar?week=${week}`, false);
  const days = weekDays(week),
    all = (data?.items || []).filter(
      (item) =>
        item.airType === type && (animation === 'all' || scheduleCategory(item) === animation),
    );
  const localDay = (item) => (item.airingAt ? localDateKey(item.airingAt, zone) : null);
  const list = all
    .filter((item) => localDay(item) === day)
    .sort((a, b) => Date.parse(a.airingAt) - Date.parse(b.airingAt));
  const unconfirmed = all.filter((item) => !item.airingAt);
  const dateLabel = (date, options) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });
  const timeLabel = (date) =>
    new Date(date).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone,
    });
  const zoneLabel = (date) =>
    new Intl.DateTimeFormat(undefined, { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(new Date(date))
      .find((part) => part.type === 'timeZoneName')?.value;
  function changeWeek(next) {
    setWeek(next);
    setDay(next === currentWeek ? today : next);
  }
  const unavailable = data && data.state !== 'ready';
  const cards = (items) => (
    <div className="schedule-list" key={`${day}:${type}:${animation}`}>
      {items.map((item) => (
        <a
          className="schedule-item"
          key={item.id}
          href={item.providerUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <CoverImage media={item} alt="" className="schedule-artwork" aria-hidden="true" />
          <span className="schedule-time">
            {item.airingAt ? (
              <time dateTime={item.airingAt}>{timeLabel(item.airingAt)}</time>
            ) : (
              'TBA'
            )}
            <small>{item.airingAt ? zoneLabel(item.airingAt) : 'Time unconfirmed'}</small>
          </span>
          <CoverImage media={item} alt="" className="schedule-cover" />
          <div>
            <span className="eyebrow">
              {types[item.airType]}
              {item.episode ? ` · Episode ${item.episode}` : ''}
            </span>
            <h3>{item.title}</h3>
            <span className={item.delayed ? 'schedule-delayed' : ''}>
              {airingLabel(item, now)}
              {item.delayNote && item.delayNote !== 'Delayed' ? ` · ${item.delayNote}` : ''}
              {item.delayed && item.delayedUntil && (
                <span className="schedule-delay-target">
                  {' '}
                  · Delayed until{' '}
                  <time dateTime={item.delayedUntil}>
                    {new Date(item.delayedUntil).toLocaleString(undefined, {
                      timeZone: zone,
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZoneName: 'short',
                    })}
                  </time>
                </span>
              )}
            </span>
          </div>
          <ExternalLink size={16} aria-label="View on AnimeSchedule.net" />
        </a>
      ))}
    </div>
  );
  return (
    <div className="page section-page schedule-page">
      <header className="section-page-heading">
        <div>
          <span className="section-kicker">
            <CalendarDays size={13} /> THE WEEK AHEAD
          </span>
          <h1>Airing schedule</h1>
          <p>Your next episode, on your time. Explore the week in your local timezone.</p>
        </div>
        {picker}
      </header>
      <section className="schedule-calendar" aria-label="Choose a day and release type">
        <div className="schedule-toolbar">
          <div className="schedule-animation-filters" role="group" aria-label="Animation category">
            {Object.entries(animationCategories).map(([value, label]) => (
              <button
                key={value}
                title={value === 'cartoons' ? 'Children’s and family series' : undefined}
                aria-pressed={animation === value}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set('animation', value);
                  setParams(next);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="schedule-types" role="group" aria-label="Release type">
            {Object.entries(types).map(([value, label]) => (
              <button key={value} aria-pressed={value === type} onClick={() => setType(value)}>
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
        <div className="schedule-days" ref={phoneDays}>
          {days.map((date) => (
            <button
              key={date}
              className={date === day ? 'active' : ''}
              aria-pressed={date === day}
              onClick={() => setDay(date)}
            >
              <span>{dateLabel(date, { weekday: 'short' })}</span>
              <strong>{dateLabel(date, { month: 'short', day: 'numeric' })}</strong>
              <small>
                {loading ||
                error ||
                !data ||
                data.state === 'unavailable' ||
                data.state === 'not-configured'
                  ? '—'
                  : date === today
                    ? 'Today'
                    : `${all.filter((item) => localDay(item) === date).length} releases`}
              </small>
            </button>
          ))}
        </div>
      </section>
      {loading ? (
        <div
          className="schedule-loading section-loading"
          role="status"
          aria-label="Loading schedule"
        >
          <span className="sr-only">Loading your schedule…</span>
          {Array.from({ length: 6 }, (_, index) => (
            <div className="section-skeleton" key={index}>
              <span />
              <div>
                <i />
                <i />
                <i />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorNotice message={error} retry={refresh} />
      ) : (
        <>
          {unavailable && (
            <div className="schedule-status" role="status">
              <div>
                <strong>
                  {data.state === 'not-configured'
                    ? 'The schedule is being connected.'
                    : data.state === 'unavailable'
                      ? 'The schedule is temporarily unavailable.'
                      : 'Some schedule updates are unavailable.'}
                </strong>
                <p>
                  {data.updatedAt
                    ? 'Showing the last saved times. Some updates may be missing.'
                    : 'We couldn’t load confirmed times. Please try again shortly.'}
                </p>
              </div>
              <button onClick={refresh}>
                <RefreshCw size={14} />
                Retry
              </button>
            </div>
          )}
          <div className="schedule-day-heading" aria-live="polite">
            <h2>{dateLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
            <span>{list.length} releases</span>
          </div>
          {list.length
            ? cards(list)
            : !unavailable && (
                <Empty icon={CalendarDays} title="A little breathing room.">
                  No {types[type].toLowerCase()} releases in this category for this day. Try another
                  day, category, or release type.
                </Empty>
              )}
          {unconfirmed.length > 0 && (
            <section className="schedule-unconfirmed">
              <h2>Times to be confirmed</h2>
              {cards(unconfirmed)}
            </section>
          )}
          <p className="schedule-attribution">
            Schedule by{' '}
            <a href="https://animeschedule.net" target="_blank" rel="noopener noreferrer">
              AnimeSchedule.net
            </a>
            {data?.updatedAt &&
              ` · Updated ${new Date(data.updatedAt).toLocaleString(undefined, { timeZone: zone })}`}
          </p>
        </>
      )}
    </div>
  );
}
