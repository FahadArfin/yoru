import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Clock } from 'lucide-react';
import { coverOf, itemsOf, titleOf } from '../api';
import { useResource } from '../state';
import { Empty, ErrorNotice, Loading } from '../components';
export default function Schedule() {
  const { data, loading, error, refresh } = useResource('/api/calendar');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const [day, setDay] = useState(days[(new Date().getDay() + 6) % 7]);
  const list = itemsOf(data).filter((item) => {
    const media = item.media || item;
    return (item.day || media.broadcast?.day || '')
      .toLowerCase()
      .startsWith(day.toLowerCase().slice(0, 3));
  });
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow">SOMETHING TO LOOK FORWARD TO</span>
        <h1>Make room for your favorites.</h1>
        <p>Airing anime, throughout the week.</p>
      </div>
      <div className="schedule-days">
        {days.map((d) => (
          <button key={d} className={d === day ? 'active' : ''} onClick={() => setDay(d)}>
            <span>{d.slice(0, 3)}</span>
            {d === days[(new Date().getDay() + 6) % 7] && <small>Today</small>}
          </button>
        ))}
      </div>
      <p className="schedule-note">
        <Clock size={15} />
        Broadcast times are listed in the provider’s stated timezone. Simulcast availability can
        differ.
      </p>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={refresh} />
      ) : list.length ? (
        <div className="schedule-list">
          {list.map((item) => {
            const media = item.media || item;
            return (
              <Link className="schedule-item" key={media.id} to={`/title/${media.id}`}>
                <span className="schedule-time">
                  {media.broadcast?.time || item.time || 'TBA'}
                  <small>{media.broadcast?.timezone || 'Time TBA'}</small>
                </span>
                <img src={coverOf(media)} alt="" />
                <div>
                  <span className="eyebrow">AIRING ANIME</span>
                  <h3>{titleOf(media)}</h3>
                  <span>
                    {media.format || 'TV'} · {media.genres?.[0]}
                  </span>
                </div>
                <ArrowRight size={18} />
              </Link>
            );
          })}
        </div>
      ) : (
        <Empty icon={CalendarDays} title="A little breathing room.">
          No verified broadcasts are available for {day}. Check another day or explore a new series
          while you wait.
        </Empty>
      )}
    </div>
  );
}
