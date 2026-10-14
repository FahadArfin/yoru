import React, { useState } from 'react';
import HomeLead from './HomeLead';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Play } from 'lucide-react';
import { useApp, useResource } from '../state';
import { bannerOf, coverOf, isAnime, itemsOf, titleOf } from '../api';
import { ErrorNotice, Loading, Poster, PosterRail, Section } from '../components';
export default function Home() {
  const anime = useResource('/api/catalog?category=ANIME&curated=1');
  const manga = useResource('/api/catalog?category=MANGA&curated=1');
  const manhwa = useResource('/api/catalog?category=MANHWA&curated=1');
  const { library } = useApp();
  const [tab, setTab] = useState('ANIME');
  const mangaItems = itemsOf(manga.data),
    manhwaItems = itemsOf(manhwa.data);
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
              <Section
                eyebrow="JUST ONE MORE CHAPTER"
                title="Beyond the screen"
                href="/browse/manhwa"
              >
                <div className="editorial-grid">
                  <Link to="/browse/manga" className="editorial-card manga-editorial">
                    {mangaItems[0] && <img src={coverOf(mangaItems[0])} alt="" loading="lazy" />}
                    <div>
                      <span className="eyebrow">INK. PANELS. OBSESSION.</span>
                      <h3>
                        Made for
                        <br />
                        page-turners.
                      </h3>
                      <span>
                        Explore manga <ArrowRight size={16} />
                      </span>
                    </div>
                  </Link>
                  <Link to="/browse/manhwa" className="editorial-card manhwa-editorial">
                    {manhwaItems[0] && <img src={coverOf(manhwaItems[0])} alt="" loading="lazy" />}
                    <div>
                      <span className="eyebrow">COLOR OUTSIDE THE LINES</span>
                      <h3>
                        Scroll into
                        <br />
                        another world.
                      </h3>
                      <span>
                        Explore manhwa <ArrowRight size={16} />
                      </span>
                    </div>
                  </Link>
                </div>
              </Section>
            </div>
          </div>
          <Section
            eyebrow="YOUR NEXT READING RABBIT HOLE"
            title="Manhwa worth the scroll"
            href="/browse/manhwa"
          >
            <PosterRail items={manhwaItems.slice(0, 8)} />
          </Section>
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
