import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BookCheck,
  BookOpen,
  Bookmark,
  Crown,
  MessageSquare,
  Star,
} from 'lucide-react';
import { useApp, useResource } from '../state';
import { bannerOf, coverOf, itemsOf, titleOf } from '../api';
import Browse from './Browse';
import MangaHero from './MangaHero';
import MangaDiscovery, { useMangaFeed } from './MangaDiscovery';
import '../manga.css';

function MangaRow({ media }) {
  return (
    <Link className="rail-media-row" to={`/title/${media.id}`}>
      <img className="rail-backdrop" src={bannerOf(media)} alt="" loading="lazy" />
      <img className="rail-poster" src={coverOf(media)} alt="" loading="lazy" />
      <div className="rail-row-copy">
        <strong>{titleOf(media)}</strong>
        <span className="rail-meta">
          MANGA {media.year && <span>· {media.year}</span>}
          {media.score > 0 && (
            <span className="rail-score">
              <Star size={11} fill="currentColor" />
              {Number(media.score).toFixed(1)}
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}

function MangaLanding() {
  const popular = useMangaFeed('popular');
  const curated = useResource('/api/catalog?category=MANGA&curated=1');
  const picks = popular.data?.items?.length ? popular.data.items : itemsOf(curated.data);
  const { user, setAuthOpen } = useApp();
  const completed = picks.filter((item) => item.status === 'Finished').slice(0, 4);
  return (
    <div className="home-page cinema-home manga-home">
      <MangaHero items={picks} />
      <div className="manga-intro home-width">
        <div>
          <BookOpen size={19} />
          <span>
            <strong>A little more obsessed. One chapter at a time.</strong>
            <small>Discover something new, or fall back into an old favorite.</small>
          </span>
        </div>
        <a href="#manga-catalog">
          Explore the collection <ArrowRight size={15} />
        </a>
      </div>
      <div className="home-content-layout home-width">
        <div className="home-release-column">
          <MangaDiscovery popular={popular} />
        </div>
        <aside className="home-right-rail" aria-label="Manga highlights">
          <section className="home-rail-panel" aria-label="Reader favorites">
            <div className="rail-heading">
              <h2>
                <Crown size={14} /> Reader favorites
              </h2>
            </div>
            <p className="rail-note">
              {popular.data?.items?.length
                ? 'Popular with Kitsu readers'
                : 'From the Yoru collection'}
            </p>
            {picks.slice(0, 4).map((media) => (
              <MangaRow key={media.id} media={media} />
            ))}
          </section>
          {completed.length > 0 && (
            <section className="home-rail-panel" aria-label="Completed stories">
              <div className="rail-heading">
                <h2>
                  <BookCheck size={14} /> Completed stories
                </h2>
              </div>
              <p className="rail-note">The whole story is waiting.</p>
              {completed.map((media) => (
                <MangaRow key={media.id} media={media} />
              ))}
            </section>
          )}
          <section className="home-rail-panel manga-rail-cta" aria-label="Your reading list">
            <Bookmark size={24} />
            <h2>Your next chapter.</h2>
            <p>Keep your favorites close. Save a manga and pick up where you left off.</p>
            {user ? (
              <Link to="/library">
                Open your library <ArrowRight size={14} />
              </Link>
            ) : (
              <button onClick={() => setAuthOpen(true)}>
                Build your reading list <ArrowRight size={14} />
              </button>
            )}
          </section>
          <section className="home-rail-panel manga-rail-cta" aria-label="Manga community">
            <MessageSquare size={22} />
            <h2>Better with your people.</h2>
            <p>
              Share a favorite. Find your next recommendation. There’s always more to talk about.
            </p>
            <Link to="/community">
              Join the conversation <ArrowRight size={14} />
            </Link>
          </section>
        </aside>
      </div>
      <div className="manga-catalog-wrap home-width">
        <Browse embedded categoryOverride="manga" />
      </div>
    </div>
  );
}

export default function MangaPage() {
  const [params] = useSearchParams();
  const filtered = ['q', 'genre', 'sort', 'page'].some((key) => params.get(key));
  return filtered ? (
    <>
      <div className="manga-return">
        <Link to="/browse/manga">← Manga discovery</Link>
      </div>
      <Browse categoryOverride="manga" />
    </>
  ) : (
    <MangaLanding />
  );
}
