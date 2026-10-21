import React from 'react';
import { BookOpen, Star, Play, Eye } from 'lucide-react';
import { isAnime, titleOf } from '../api';
import CoverImage from '../CoverImage';
import PrefetchLink from '../PrefetchLink';

export function MangaCard({ media, index, mode }) {
  const anime = isAnime(media);
  const Icon = anime ? Play : BookOpen;
  return (
    <PrefetchLink
      media={media}
      className="release-card"
      to={anime && mode === 'trending' ? `/watch/${media.id}/latest` : `/title/${media.id}`}
    >
      <div className="release-poster">
        <CoverImage media={media} alt="" loading="lazy" />
        {mode !== 'new' && (
          <span className="discovery-rank">
            <small>#</small>
            {String(index + 1).padStart(2, '0')}
          </span>
        )}
        <span className="release-play">
          <Icon size={25} />
        </span>
        <span className="release-badges">
          <span>{media.category || (anime ? 'ANIME' : 'MANGA')}</span>
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
              {anime ? <Eye size={12} /> : <BookOpen size={12} />}
              {Number(media.viewers).toLocaleString()}{' '}
              {anime
                ? media.viewers === 1
                  ? 'viewer'
                  : 'viewers'
                : media.viewers === 1
                  ? 'reader'
                  : 'readers'}{' '}
              this week
            </>
          ) : mode === 'new' && media.startDate ? (
            <time dateTime={media.startDate}>
              {anime ? 'Premiere' : 'Started'}{' '}
              {new Date(media.startDate).toLocaleDateString(undefined, {
                month: 'short',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </time>
          ) : (
            <>
              {media.year || media.category}
              {(anime ? media.episodes : media.chapters) > 0 && (
                <>
                  <i>·</i>
                  {anime ? `${media.episodes} episodes` : `${media.chapters} chapters`}
                </>
              )}
            </>
          )}
        </span>
      </div>
    </PrefetchLink>
  );
}
