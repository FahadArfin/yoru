import React from 'react';
import { Link } from './collection-router';
import { titleOf, plainText, scoreOf } from './api';
import CoverImage from './CoverImage';

export default function WatchDetails({ media }) {
  return (
    <section className="watch-details" aria-label="About this anime">
      <Link to={`/title/${media.id}`} className="watch-details-cover">
        <CoverImage media={media} alt={`${titleOf(media)} cover`} />
      </Link>
      <div className="watch-details-copy">
        <span className="eyebrow">ABOUT THE SERIES</span>
        <h2>
          <Link className="watch-details-title" to={`/title/${media.id}`}>
            {titleOf(media)}
          </Link>
        </h2>
        <p className="watch-details-native">
          {media.titleNative || media.titleJapanese || media.titleRomaji}
        </p>
        <div className="watch-details-facts">
          <span>{media.format || 'Anime'}</span>
          {media.year && <span>{media.year}</span>}
          {media.episodes && <span>{media.episodes} episodes</span>}
          {media.duration && <span>{media.duration}</span>}
          {scoreOf(media) > 0 && (
            <span>
              ★ {scoreOf(media).toFixed(2)} · {media.source === 'Kitsu' ? 'Kitsu' : 'MAL'}
            </span>
          )}
          <span>{String(media.status || '').replaceAll('_', ' ')}</span>
        </div>
        <p className="watch-details-synopsis">
          {plainText(media.description) || 'A synopsis is not available for this title yet.'}
        </p>
        <div className="genre-chips">
          {media.genres?.map((genre) => (
            <Link key={genre} to={`/browse/anime?genre=${encodeURIComponent(genre)}`}>
              {genre}
            </Link>
          ))}
        </div>
        <Link className="text-link" to={`/title/${media.id}?tab=episodes`}>
          Full episode guide & series details →
        </Link>
      </div>
    </section>
  );
}
