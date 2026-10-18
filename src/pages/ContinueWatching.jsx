import React from 'react';
import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import { useApp } from '../state';
import { bannerOf, isAnime, titleOf } from '../api';
import { Section } from '../components';

export default function ContinueWatching() {
  const { library } = useApp();
  const items = library.filter(
    (entry) =>
      entry.media &&
      isAnime(entry.media) &&
      ['watching', 'current'].includes(entry.status) &&
      entry.progress > 0,
  );
  if (!items.length) return null;
  return (
    <div className="home-continue" role="region" aria-label="Continue watching">
      <Section eyebrow="RIGHT WHERE YOU LEFT OFF" title="Continue watching" href="/library">
        <div className="continue-grid">
          {items.slice(0, 3).map((entry) => (
            <Link
              key={entry.mediaId}
              to={`/watch/${entry.mediaId}/${Math.max(1, entry.progress)}`}
              className="continue-card"
            >
              <img src={bannerOf(entry.media)} alt="" loading="lazy" />
              <span className="continue-play">
                <Play size={19} />
              </span>
              <div>
                <strong>{titleOf(entry.media)}</strong>
                <span>Episode {entry.progress} · Pick it back up</span>
              </div>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
