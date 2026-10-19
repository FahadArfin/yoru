import React, { useRef } from 'react';
import { Link, useSearchParams } from '../collection-router';
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
import { bannerOf, itemsOf, titleOf } from '../api';
import CoverImage from '../CoverImage';
import PrefetchLink from '../PrefetchLink';
import Browse from './Browse';
import MangaHero from './MangaHero';
import MangaDiscovery, { useMangaFeed } from './MangaDiscovery';
import HomeDiscovery from './HomeDiscovery';
import LiveComments from './LiveComments';
import { PickUpWhereLeftOff } from '../reader/ReadingCollection';
import '../manga.css';
import { useCollection } from '../collection-context';
import { useReaderSelection } from '../useCatalogPreferences';

function MangaRow({ media }) {
  return (
    <PrefetchLink media={media} className="rail-media-row" to={`/title/${media.id}`}>
      <img className="rail-backdrop" src={bannerOf(media)} alt="" loading="lazy" />
      <CoverImage className="rail-poster" media={media} alt="" />
      <div className="rail-row-copy">
        <strong>{titleOf(media)}</strong>
        <span className="rail-meta">
          {media.category} {media.year && <span>· {media.year}</span>}
          {media.score > 0 && (
            <span className="rail-score">
              <Star size={11} fill="currentColor" />
              {Number(media.score).toFixed(1)}
            </span>
          )}
        </span>
      </div>
    </PrefetchLink>
  );
}

export function MangaLanding({ category, label, homepage = false, children, categoryControls }) {
  const scope = useCollection();
  const selection = useReaderSelection();
  const coreAllowed = selection?.ready && selection.context.integrationMode !== 'extensions';
  const selectionKey = `${category}:${selection?.context?.owner}:${selection?.context?.destination}:${selection?.context?.selectionFingerprint}`;
  const popular = useMangaFeed('popular', 'all', category);
  const curated = useResource(
    coreAllowed ? `/api/catalog?category=${category.toUpperCase()}&curated=1` : null,
  );
  const previousPopular = useRef({ key: selectionKey, items: [] });
  if (previousPopular.current.key !== selectionKey || !coreAllowed)
    previousPopular.current = { key: selectionKey, items: [] };
  if (coreAllowed && Array.isArray(popular.data?.items))
    previousPopular.current = { key: selectionKey, items: popular.data.items };
  // Keep the featured lineup stable while the periodic background refresh is in flight.
  const picks = previousPopular.current.items.length
    ? previousPopular.current.items
    : coreAllowed
      ? itemsOf(curated.data)
      : [];
  const { user, setAuthOpen } = useApp();
  const completed = picks.filter((item) => item.status === 'Finished').slice(0, 4);
  return (
    <div
      className={`home-page cinema-home manga-home ${category === 'manhwa' ? 'manhwa-home' : ''} ${homepage ? '' : 'compact-category-page'}`}
    >
      {coreAllowed ? (
        <MangaHero
          items={picks}
          category={category}
          label={label}
          categoryControls={categoryControls}
        />
      ) : (
        <div className="home-width">
          <h1>{label}</h1>
          {categoryControls}
        </div>
      )}
      {homepage && (
        <div className="home-resume home-width">
          <PickUpWhereLeftOff />
        </div>
      )}
      {!homepage && (
        <div className="manga-intro home-width">
          <div>
            <BookOpen size={19} />
            <span>
              <strong>
                {category === 'manhwa'
                  ? 'A little more obsessed. One scroll at a time.'
                  : 'A little more obsessed. One chapter at a time.'}
              </strong>
              <small>Discover something new, or fall back into an old favorite.</small>
            </span>
          </div>
          <a href={`#${category}-catalog`}>
            Explore the collection <ArrowRight size={15} />
          </a>
        </div>
      )}
      <div className={`home-content-layout home-width ${homepage ? 'home-discovery-layout' : ''}`}>
        <div className="home-release-column">
          {homepage && <HomeDiscovery category={category} />}
          {homepage && <LiveComments />}
          {!homepage && <MangaDiscovery popular={popular} category={category} label={label} />}
          {children}
        </div>
        {coreAllowed && (
          <aside
            className={`home-right-rail ${homepage ? 'home-lower-highlights' : ''}`}
            aria-label={`${label} highlights`}
          >
            <section className="home-rail-panel" aria-label="Reader favorites">
              <div className="rail-heading">
                <h2>
                  <Crown size={14} /> Reader favorites
                </h2>
              </div>
              <p className="rail-note">
                {scope?.active
                  ? 'From the Ara Ara collection'
                  : popular.data?.items?.length
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
              <p>Keep your favorites close. Save a {category} and pick up where you left off.</p>
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
            {!homepage && (
              <section className="home-rail-panel manga-rail-cta" aria-label={`${label} community`}>
                <MessageSquare size={22} />
                <h2>Better with your people.</h2>
                <p>
                  Share a favorite. Find your next recommendation. There’s always more to talk
                  about.
                </p>
                <Link to="/community">
                  Join the conversation <ArrowRight size={14} />
                </Link>
              </section>
            )}
          </aside>
        )}
      </div>
      {!homepage && (
        <div className="manga-catalog-wrap home-width">
          <Browse embedded categoryOverride={category} />
        </div>
      )}
    </div>
  );
}

export default function MangaPage({ category = 'manga' }) {
  const label = category === 'manhwa' ? 'Manhwa' : 'Manga';
  const [params] = useSearchParams();
  const filtered = ['q', 'genre', 'sort', 'page', 'view', 'source', 'language'].some((key) =>
    params.get(key),
  );
  return filtered ? (
    <>
      <div className="manga-return">
        <Link to={`/browse/${category}`}>← {label} discovery</Link>
      </div>
      <Browse categoryOverride={category} />
    </>
  ) : (
    <MangaLanding category={category} label={label} />
  );
}
