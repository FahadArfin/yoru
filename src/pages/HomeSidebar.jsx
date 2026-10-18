import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from '../collection-router';
import { CalendarDays, ChevronDown, Clock3 } from 'lucide-react';
import { useResource } from '../state';
import { airingLabel, localDateKey, shiftDate, weekDays, weekStart } from '../../shared/schedule';

export function HomeAiringSchedule({ language }) {
  const [now, setNow] = useState(Date.now());
  const today = localDateKey(now);
  const [selected, setSelected] = useState(null);
  const day = selected || today;
  const daysRef = useRef(null);
  const dayPositions = useRef(new Map());
  useLayoutEffect(() => {
    const positions = dayPositions.current;
    dayPositions.current = new Map();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animations = [];
    const bounds = daysRef.current.getBoundingClientRect();
    for (const button of daysRef.current?.querySelectorAll('button') || []) {
      const before = positions.get(button.dataset.date);
      if (before === undefined) continue;
      const offset = before - button.getBoundingClientRect().left;
      if (Math.abs(offset) < 1) continue;
      const left = button.getBoundingClientRect().left;
      // Wrapped days leave behind the clipped left edge, then re-enter from
      // the right instead of visibly travelling backwards across the strip.
      const frames =
        offset < 0
          ? [
              { transform: `translateX(${offset}px)`, opacity: 1, offset: 0 },
              {
                transform: `translateX(${bounds.left - left - button.offsetWidth}px)`,
                opacity: 0,
                offset: 0.45,
              },
              { transform: `translateX(${bounds.right - left}px)`, opacity: 0, offset: 0.46 },
              { transform: 'translateX(0)', opacity: 1, offset: 1 },
            ]
          : [{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0)' }];
      animations.push(
        button.animate(frames, {
          duration: 520,
          easing: 'cubic-bezier(.22,1,.36,1)',
        }),
      );
    }
    return () => animations.forEach((animation) => animation.cancel());
  }, [day]);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(true);
  const [shown, setShown] = useState({ day, filter, language });
  const results = useRef(null);
  const previousHeight = useRef(0);
  useLayoutEffect(() => {
    const target = { day, filter, language };
    const node = results.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(target);
      return;
    }
    if (shown.day === day && shown.filter === filter && shown.language === language) return;
    previousHeight.current = node.getBoundingClientRect().height;
    const fade = node.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 110,
      fill: 'forwards',
      easing: 'ease-out',
    });
    fade.onfinish = () => {
      setShown(target);
      fade.cancel();
    };
    return () => {
      fade.onfinish = null;
      fade.cancel();
    };
  }, [day, filter, language]);
  useLayoutEffect(() => {
    const node = results.current;
    if (
      !node ||
      !previousHeight.current ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const height = node.getBoundingClientRect().height;
    const reveal = node.animate(
      [
        { opacity: 0, transform: 'translateY(6px)', height: `${previousHeight.current}px` },
        { opacity: 1, transform: 'translateY(0)', height: `${height}px` },
      ],
      { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' },
    );
    return () => reveal.cancel();
  }, [shown]);
  const start = weekStart(today);
  const yesterday = shiftDate(today, -1);
  const days = weekDays(today);
  const selectedIndex = Math.max(0, days.indexOf(day));
  const orderedDays = [yesterday, ...days.slice(selectedIndex), ...days.slice(0, selectedIndex)];
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
  }, [calendar.refresh]);
  useEffect(() => {
    setSelected(null);
    setExpanded(true);
  }, [today]);
  const items = (calendar.data?.items || [])
    .filter(
      (x) => x.airType === shown.language && x.airingAt && localDateKey(x.airingAt) === shown.day,
    )
    .filter(
      (x) =>
        shown.filter === 'all' ||
        (shown.filter === 'aired'
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
      <div ref={daysRef} className="rail-days" aria-label="Schedule day">
        {orderedDays.map((date) => (
          <button
            key={date}
            data-date={date}
            className={date === yesterday ? 'is-yesterday' : undefined}
            title={date === yesterday ? 'Yesterday — view aired anime' : undefined}
            aria-pressed={date === day}
            aria-label={new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
            aria-current={date === today ? 'date' : undefined}
            onClick={() => {
              if (date === day) return;
              // Capture the visible positions, including any in-flight slide, before reordering.
              dayPositions.current = new Map(
                [...daysRef.current.querySelectorAll('button')].map((button) => [
                  button.dataset.date,
                  button.getBoundingClientRect().left,
                ]),
              );
              setSelected(date);
              setExpanded(true);
            }}
          >
            <span>
              {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}
            </span>
            <small aria-hidden={date !== day && date !== yesterday}>
              {date === yesterday && 'Yesterday · '}
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
                setExpanded(true);
              }}
            >
              {value}
            </button>
          ))}
        </div>
        <small>
          {items.length} airing · {shown.language}
        </small>
      </div>
      {calendar.data?.stale && <p className="rail-note">Showing the latest saved schedule.</p>}
      <div
        ref={results}
        className="home-schedule-results"
        aria-busy={shown.day !== day || shown.filter !== filter || shown.language !== language}
      >
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
      </div>
    </section>
  );
}
