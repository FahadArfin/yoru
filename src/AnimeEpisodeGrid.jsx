import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Play, Search } from 'lucide-react';
import { useApp, useResource } from './state';
import CoverImage from './CoverImage';
import './anime-episodes.css';

export default function AnimeEpisodeGrid({ media }) {
  const [group, setGroup] = useState(0);
  const [draft, setDraft] = useState('');
  const [highlight, setHighlight] = useState(null);
  const section = useRef();
  const { entryFor } = useApp();
  const progress = entryFor(media.id)?.progress || 0;
  const providerPage = Math.floor(group / 2) + 1;
  const result = useResource(`/api/media/${media.id}/episodes?page=${providerPage}`);
  const data = result.data;
  const knownTotal = Number(media.episodes) || data?.total;
  const total = Math.max(knownTotal || 0, ...(data?.items || []).map((x) => x.number));
  const rangeTotal = knownTotal || Math.max(total, (data?.pages || 1) * 100);
  const groups = Math.max(1, Math.min(2000, Math.ceil(rangeTotal / 50)));
  const lower = group * 50 + 1,
    upper = Math.min(lower + 49, rangeTotal);
  const partial = result.error || data?.partial;
  const upcoming = /^(not yet aired|upcoming|tba)$/i.test(media.status || '');
  let items = data?.items?.filter((item) => item.number >= lower && item.number <= upper) || [];
  // Keep numbered navigation usable during metadata outages, without inventing episode details.
  if (!items.length && !result.loading && partial && knownTotal && !upcoming) {
    items = Array.from(
      { length: Math.max(0, Math.min(50, knownTotal - lower + 1)) },
      (_, index) => ({ number: lower + index, title: `Episode ${lower + index}`, fallback: true }),
    );
  }
  useEffect(() => {
    if (highlight && !result.loading)
      section.current
        ?.querySelector(`[data-episode="${highlight}"]`)
        ?.focus({ preventScroll: true });
  }, [highlight, result.loading, group]);
  const findEpisode = (event) => {
    event.preventDefault();
    const value = Number(draft);
    if (!Number.isInteger(value) || value < 1 || value > rangeTotal) return;
    setGroup(Math.floor((value - 1) / 50));
    setHighlight(value);
  };
  return (
    <section ref={section} className="anime-episode-guide" aria-label="Episode guide">
      <div className="episode-guide-heading">
        <div>
          <span className="eyebrow">PICK YOUR NEXT EPISODE</span>
          <h2>Episodes</h2>
        </div>
        <span>{knownTotal ? `${knownTotal.toLocaleString()} episodes` : 'Ongoing series'}</span>
      </div>
      <div className="episode-guide-controls">
        <div className="episode-guide-ranges">
          <button
            aria-label="Previous episode range"
            disabled={!group}
            onClick={() => setGroup((value) => value - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <select
            aria-label="Episode range"
            value={group}
            onChange={(e) => {
              setGroup(Number(e.target.value));
              setHighlight(null);
            }}
          >
            {Array.from({ length: groups }, (_, index) => (
              <option key={index} value={index}>
                Episodes {index * 50 + 1}–{Math.min((index + 1) * 50, rangeTotal)}
              </option>
            ))}
          </select>
          <button
            aria-label="Next episode range"
            disabled={group >= groups - 1}
            onClick={() => setGroup((value) => value + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <form onSubmit={findEpisode}>
          <Search size={15} />
          <input
            aria-label="Find episode number"
            type="number"
            min="1"
            max={rangeTotal}
            required
            placeholder="Episode number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit">Find</button>
        </form>
      </div>
      {partial && (
        <p className="episode-guide-note" role="status">
          Episode details are temporarily unavailable.{' '}
          {knownTotal ? 'Numbered navigation is still available.' : 'Try again in a moment.'}{' '}
          <button onClick={result.refresh}>Retry details</button>
        </p>
      )}
      <div className="anime-episode-cards" aria-busy={result.loading}>
        {result.loading
          ? Array.from({ length: 8 }, (_, index) => (
              <div className="episode-card-skeleton" key={index} />
            ))
          : items.map((item) => {
              const future = upcoming || Boolean(item.aired && Date.parse(item.aired) > Date.now());
              const body = (
                <>
                  <div className={`episode-card-art${item.image ? '' : ' is-series-art'}`}>
                    <CoverImage
                      media={{ cover: item.image || media.banner || media.cover }}
                      alt=""
                    />
                    <span className="episode-card-number">EP {item.number}</span>
                    {!item.image && <span className="episode-art-label">Series artwork</span>}
                    <span className="episode-card-play">
                      {future ? (
                        'Upcoming'
                      ) : item.number <= progress ? (
                        <Check size={23} />
                      ) : (
                        <Play size={23} fill="currentColor" />
                      )}
                    </span>
                  </div>
                  <div className="episode-card-copy">
                    <strong>{item.title}</strong>
                    <small>
                      {future
                        ? 'Not aired yet'
                        : item.number <= progress
                          ? 'Completed'
                          : item.aired
                            ? `Aired ${new Date(item.aired).toLocaleDateString()}`
                            : 'Release date unavailable'}
                      {item.filler ? ' · Filler' : item.recap ? ' · Recap' : ''}
                    </small>
                  </div>
                </>
              );
              return future ? (
                <article className="anime-episode-card is-upcoming" key={item.number}>
                  {body}
                </article>
              ) : (
                <Link
                  className={`anime-episode-card${highlight === item.number ? ' is-highlighted' : ''}`}
                  key={item.number}
                  data-episode={item.number}
                  aria-label={`Watch episode ${item.number}: ${item.title}`}
                  to={`/watch/${media.id}/${item.number}`}
                >
                  {body}
                </Link>
              );
            })}
      </div>
      {!result.loading && !items.length && (
        <p className="episode-guide-empty">
          {upcoming
            ? 'Episodes will appear once this anime starts airing.'
            : 'No episode details are available for this range yet.'}
        </p>
      )}
      <div className="episode-guide-bottom">
        <span>
          Episodes {lower}–{upper} · {data?.source || 'Episode guide'}
        </span>
        <div>
          <button disabled={!group} onClick={() => setGroup((value) => value - 1)}>
            Previous
          </button>
          <button disabled={group >= groups - 1} onClick={() => setGroup((value) => value + 1)}>
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
