import { useState } from 'react';
import { Check, MessageSquare, Mic, Play } from 'lucide-react';
import { bannerOf, plainText } from './api';
import CoverImage from './CoverImage';

export default function WatchEpisodePreview({
  media,
  episode,
  number,
  active,
  completed,
  language,
  loading,
}) {
  const [failedImage, setFailedImage] = useState(null);
  const image = episode?.image && failedImage !== episode.image ? episode.image : null;
  const title = plainText(episode?.title) || `Episode ${number}`;
  const summary = plainText(episode?.description).replace(/\s+/g, ' ').trim();
  return (
    <>
      <span className={`watch-episode-art${image ? '' : ' is-series-art'}`}>
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailedImage(image)}
          />
        ) : (
          <CoverImage media={{ ...media, cover: bannerOf(media) }} alt="" />
        )}
        <span className="watch-episode-badge">EP {number}</span>
        {!image && <span className="watch-episode-art-label">Series artwork</span>}
        <span className="watch-episode-play" aria-hidden="true">
          <Play size={16} fill="currentColor" />
        </span>
      </span>
      <span className="episode-copy">
        <strong title={title}>{title}</strong>
        <small
          className={loading && !episode ? 'episode-detail-loading' : ''}
          title={summary || undefined}
        >
          {summary ||
            (loading
              ? 'Loading episode details…'
              : episode?.aired
                ? `Aired ${new Date(episode.aired).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
                : 'Episode details unavailable')}
        </small>
        <span className="watch-episode-meta">
          <span
            className="watch-episode-language"
            title={`Selected playback language: ${language === 'dub' ? 'English dub' : 'subtitles'}`}
          >
            {language === 'dub' ? <Mic size={10} /> : <MessageSquare size={10} />}{' '}
            {language.toUpperCase()}
          </span>
          {active ? (
            <span className="watch-episode-current">
              <Play size={9} fill="currentColor" /> Now playing
            </span>
          ) : completed ? (
            <span>
              <Check size={10} /> Completed
            </span>
          ) : episode?.filler ? (
            <span>Filler</span>
          ) : episode?.recap ? (
            <span>Recap</span>
          ) : null}
        </span>
      </span>
    </>
  );
}
