import React, { useState } from 'react';
import HomeLead from './HomeLead';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Play } from 'lucide-react';
import { useApp, useResource } from '../state';
import { bannerOf, isAnime, itemsOf, titleOf } from '../api';
import { ErrorNotice, Loading, Poster, Section } from '../components';
export default function Home() {
  const anime = useResource('/api/catalog?category=ANIME&curated=1');
  const manga = useResource('/api/catalog?category=MANGA&curated=1');
  const manhwa = useResource('/api/catalog?category=MANHWA&curated=1');
  const { library } = useApp();
  const [tab, setTab] = useState('ANIME');
  const current = tab === 'ANIME' ? anime : tab === 'MANGA' ? manga : manhwa;
  const inProgress = library.filter(
    (item) =>
      item.media &&
      (item.status === 'watching' || item.status === 'reading' || item.status === 'current') &&
      item.progress > 0,
  );
  return (
    <div className="home-page cinema-home">
      <HomeLead>
        <div className="home-secondary">
          {inProgress.length > 0 && (
            <Section
              eyebrow="RIGHT WHERE YOU LEFT OFF"
              title="One more episode. One more chapter."
              href="/library"
            >
              <div className="continue-grid">
                {inProgress.slice(0, 3).map((entry) => (
                  <Link
                    key={entry.mediaId}
                    to={`/${isAnime(entry.media) ? 'watch' : 'read'}/${entry.mediaId}/${Math.max(1, entry.progress)}`}
                    className="continue-card"
                  >
                    <img src={bannerOf(entry.media)} alt="" />
                    <span className="continue-play">
                      {isAnime(entry.media) ? <Play size={19} /> : <BookOpen size={19} />}
                    </span>
                    <div>
                      <strong>{titleOf(entry.media)}</strong>
                      <span>
                        {isAnime(entry.media) ? 'Episode' : 'Chapter'} {entry.progress} · Pick it
                        back up
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </Section>
          )}
          <div className="home-columns">
            <div className="home-primary">
              <Section
                eyebrow="MORE STORIES, MORE WORLDS"
                title="Explore the collection"
                href={`/browse/${tab.toLowerCase()}`}
                controls={
                  <div className="segmented" aria-label="Trending category">
                    {['ANIME', 'MANGA', 'MANHWA'].map((category) => (
                      <button
                        key={category}
                        onClick={() => setTab(category)}
                        className={tab === category ? 'active' : ''}
                        aria-pressed={tab === category}
                      >
                        {category === 'MANHWA'
                          ? 'Manhwa'
                          : category === 'MANGA'
                            ? 'Manga'
                            : 'Anime'}
                      </button>
                    ))}
                  </div>
                }
              >
                {current.loading ? (
                  <Loading cards />
                ) : current.error ? (
                  <ErrorNotice message={current.error} retry={current.refresh} />
                ) : (
                  <div className="poster-grid home-poster-grid">
                    {itemsOf(current.data)
                      .slice(0, 6)
                      .map((media) => (
                        <Poster key={media.id} media={media} />
                      ))}
                  </div>
                )}
              </Section>
            </div>
          </div>
          <div className="home-ending">
            <span>✦</span>
            <p>
              You bring the curiosity.
              <br />
              <strong>We’ll bring the stories.</strong>
            </p>
            <Link to="/browse/all" className="btn btn-subtle">
              Explore everything <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </HomeLead>
    </div>
  );
}
