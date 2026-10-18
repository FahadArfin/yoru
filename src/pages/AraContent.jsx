import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, MessageCircle, Play, Search } from 'lucide-react';
import { ago, bannerOf, isAnime, plainText, titleOf } from '../api';
import { useApp, useResource } from '../state';
import { Avatar, Empty, ErrorNotice, Loading, Poster } from '../components';
import CoverImage from '../CoverImage';
import Discussion, { Reviews } from '../Discussion';
import RoomLauncher from '../RoomLauncher';
import { commentPreview } from '../../shared/comment-media';
import { localDateKey, weekStart, weekDays } from '../../shared/schedule';

export default function AraContent({ category, id }) {
  const catalog = useResource('/api/ara-ara/catalog');
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const genre = params.get('genre') || '';
  const sort = params.get('sort') || 'curated';
  const all = catalog.data?.items || [];
  const collection = all.filter((item) => !category || item.category.toLowerCase() === category);
  const genres = [...new Set(collection.flatMap((item) => item.genres || []))].sort();
  function filter(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  if (catalog.error) return <ErrorNotice message={catalog.error} retry={catalog.refresh} />;
  if (catalog.loading) return <Loading cards />;
  if (id) {
    const media = all.find((item) => item.id === id);
    return media ? (
      <AraTitle key={id} media={media} />
    ) : (
      <Empty title="Title not in this collection">
        Choose a reviewed title from the Ara Ara catalog.
      </Empty>
    );
  }
  if (category === 'schedule') return <AraSchedule />;
  if (category === 'community') return <AraCommunity titles={all} />;
  const items = collection
    .filter(
      (item) =>
        (!genre || item.genres?.includes(genre)) &&
        [item.title, item.titleRomaji, item.titleJapanese]
          .filter(Boolean)
          .some((title) => title.toLowerCase().includes(query.trim().toLowerCase())),
    )
    .sort((a, b) =>
      sort === 'score'
        ? (b.score || 0) - (a.score || 0)
        : sort === 'az'
          ? titleOf(a).localeCompare(titleOf(b))
          : 0,
    );
  const featured = collection[0];
  return (
    <>
      {!query && !genre && featured && (
        <section className="ara-feature" aria-label="Featured story">
          <img src={bannerOf(featured)} alt="" />
          <div className="ara-feature-copy">
            <span className="nsfw-eyebrow">AFTER HOURS · CURATED STORIES</span>
            <h2>{titleOf(featured)}</h2>
            <p>{featured.editorialNote}</p>
            <Link className="btn btn-primary" to={`/ara-ara/title/${featured.id}`}>
              Explore story <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      )}
      <section className="ara-catalog" aria-labelledby="ara-collection-title">
        <div className="section-heading">
          <h2 id="ara-collection-title">{category ? `Mature ${category}` : 'The collection'}</h2>
          <span className="muted">{items.length} titles</span>
        </div>
        <div className="ara-filters">
          <label className="ara-search">
            <Search size={17} />
            <span className="sr-only">Search Ara Ara</span>
            <input
              type="search"
              value={query}
              onChange={(e) => filter('q', e.target.value)}
              placeholder="Find your next story…"
            />
          </label>
          <label>
            <span className="sr-only">Genre</span>
            <select value={genre} onChange={(e) => filter('genre', e.target.value)}>
              <option value="">All genres</option>
              {genres.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Sort titles</span>
            <select value={sort} onChange={(e) => filter('sort', e.target.value)}>
              <option value="curated">Our picks</option>
              <option value="score">Top rated</option>
              <option value="az">A–Z</option>
            </select>
          </label>
        </div>
        <nav className="ara-category-tabs" aria-label="Collection format">
          {[
            ['', 'All stories'],
            ['anime', 'Anime'],
            ['manga', 'Manga'],
            ['manhwa', 'Manhwa'],
          ].map(([key, label]) => (
            <Link
              key={key}
              to={`/ara-ara${key ? `/${key}` : ''}`}
              aria-current={(category || '') === key ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ara-poster-grid">
          {items.map((media) => (
            <Poster key={media.id} media={media} href={`/ara-ara/title/${media.id}`} />
          ))}
        </div>
        {!items.length && (
          <Empty title="No matching stories">
            <button className="btn btn-secondary" onClick={() => setParams({})}>
              Clear filters
            </button>
          </Empty>
        )}
        {!!catalog.data?.unavailable && (
          <p role="status">
            Some reviewed titles are temporarily unavailable.{' '}
            <button className="text-link" onClick={catalog.refresh}>
              Retry catalog
            </button>
          </p>
        )}
      </section>
    </>
  );
}

function AraTitle({ media }) {
  const { entryFor, updateEntry } = useApp();
  const [params, setParams] = useSearchParams();
  const unit = Math.max(0, Math.min(100000, Math.trunc(Number(params.get('unit')) || 0)));
  const entry = entryFor(media.id);
  return (
    <>
      <Link className="text-link" to={`/ara-ara/${media.category.toLowerCase()}`}>
        Back to {media.category.toLowerCase()}
      </Link>
      <section className="ara-title-intro">
        <CoverImage media={media} alt={titleOf(media)} />
        <div>
          <span className="nsfw-eyebrow">{media.category} · MATURE THEMES</span>
          <h2>{titleOf(media)}</h2>
          <p>{media.editorialNote}</p>
          <p>{plainText(media.description)}</p>
          <div className="ara-title-tags">
            {media.genres?.map((genre) => (
              <span key={genre}>{genre}</span>
            ))}
          </div>
          <div className="ara-title-actions">
            <Link
              className="btn btn-primary"
              to={
                isAnime(media)
                  ? `/watch/${media.id}/${Math.max(1, entry?.progress || 1)}`
                  : `/title/${media.id}`
              }
            >
              {isAnime(media) ? <Play size={16} /> : <BookOpen size={16} />}
              {isAnime(media) ? 'Watch in Yoru' : 'Read in Yoru'}
            </Link>
            <button
              className="btn btn-secondary"
              onClick={() => updateEntry(media, { status: entry?.status || 'planned' })}
            >
              {entry ? 'In your library' : 'Add to library'}
            </button>
            <RoomLauncher media={media} />
          </div>
          <p className="ara-note">
            Your Yoru library, player, reader and rooms are shared. Availability depends on the
            title’s sources.
          </p>
        </div>
      </section>
      <div className="ara-category-tabs" role="group" aria-label="Title conversations">
        <button
          aria-pressed={params.get('tab') !== 'reviews'}
          onClick={() => setParams(unit ? { unit } : {})}
        >
          Discussion{unit ? ` · ${isAnime(media) ? 'Episode' : 'Chapter'} ${unit}` : ''}
        </button>
        <button
          aria-pressed={params.get('tab') === 'reviews'}
          onClick={() => setParams({ tab: 'reviews' })}
        >
          Reviews
        </button>
      </div>
      {params.get('tab') === 'reviews' ? (
        <Reviews mediaId={media.id} />
      ) : (
        <Discussion key={`${media.id}:${unit}`} mediaId={media.id} unit={unit} />
      )}
    </>
  );
}

function AraSchedule() {
  const [params, setParams] = useSearchParams();
  const category = ['manga', 'manhwa'].includes(params.get('format'))
    ? params.get('format')
    : 'anime';
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const today = localDateKey(Date.now(), zone);
  const [day, setDay] = useState(today);
  const [pagination, setPagination] = useState(null);
  const scope = `${category}:${day}`;
  const offset = pagination?.scope === scope ? pagination.offset : 0;
  const previous = pagination?.scope === scope ? pagination.previous : [];
  const week = weekStart(day);
  const query =
    category === 'anime'
      ? `/api/calendar?collection=ara-ara&week=${week}`
      : `/api/chapter-calendar?${new URLSearchParams({ collection: 'ara-ara', category, date: day, timezone: zone, language: 'en', offset: String(offset) })}`;
  const resource = useResource(query, false);
  const items = [
    ...new Map(
      [...previous, ...(resource.data?.items || [])].map((item) => [item.id, item]),
    ).values(),
  ].filter(
    (item) =>
      category !== 'anime' ||
      (item.airType === 'sub' && item.airingAt && localDateKey(item.airingAt, zone) === day),
  );
  return (
    <section className="ara-schedule">
      <div className="section-heading">
        <h2>
          <CalendarDays size={20} /> Schedule
        </h2>
        <span className="muted">{zone.replaceAll('_', ' ')}</span>
      </div>
      <p>
        Confirmed English-sub episode times and English chapter releases for this collection.
        Completed stories may have no new releases.
      </p>
      <div className="ara-category-tabs" role="group" aria-label="Schedule format">
        {['anime', 'manga', 'manhwa'].map((value) => (
          <button
            key={value}
            aria-pressed={category === value}
            onClick={() => {
              setPagination(null);
              setParams({ format: value });
            }}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="ara-days" role="group" aria-label="Schedule day">
        {weekDays(weekStart(today)).map((value) => (
          <button
            key={value}
            aria-pressed={day === value}
            onClick={() => {
              setPagination(null);
              setDay(value);
            }}
          >
            <strong>
              {new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}
            </strong>
            <span>
              {new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </button>
        ))}
      </div>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorNotice message={resource.error} retry={resource.refresh} />
      ) : (
        <div key={`${day}:${category}`} className="ara-release-list">
          {resource.data?.state !== 'ready' && (
            <p role="status">
              The schedule provider is temporarily unavailable. Saved results may be incomplete.{' '}
              <button className="text-link" onClick={resource.refresh}>
                Retry
              </button>
            </p>
          )}
          {items.map((item) => (
            <Link key={item.id} to={`/ara-ara/title/${item.mediaId}`}>
              <span>
                <strong>{item.title}</strong>
                <small>
                  {category === 'anime'
                    ? `Episode ${item.episode || 'TBA'}`
                    : `Chapter ${item.chapter || 'TBA'}`}
                  {item.delayed ? ` · ${item.delayNote || 'Delayed'}` : ''}
                </small>
              </span>
              <time dateTime={item.airingAt || item.publishedAt}>
                {new Date(item.airingAt || item.publishedAt).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </time>
              <ArrowRight size={15} />
            </Link>
          ))}
          {!items.length && (
            <Empty icon={CalendarDays} title="No confirmed releases for this day">
              Pick another day or explore the collection.
            </Empty>
          )}
          {resource.data?.nextOffset != null && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                setPagination({ scope, previous: items, offset: resource.data.nextOffset });
              }}
            >
              Check more releases
            </button>
          )}
          {resource.data?.capped && (
            <p className="ara-note">
              The provider’s result limit was reached. This day’s list may be incomplete.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function AraCommunity({ titles }) {
  const resource = useResource('/api/community?collection=ara-ara', false);
  const { event } = useApp();
  useEffect(() => {
    if (['comments', 'reviews', 'snapshot'].includes(event?.type)) resource.refresh();
  }, [event]);
  const allowed = new Set(titles.map((item) => item.id));
  const items = (resource.data?.items || []).filter((item) => allowed.has(item.mediaId));
  return (
    <section className="ara-community">
      <div className="section-heading">
        <h2>
          <MessageCircle size={20} /> Community
        </h2>
        <button className="text-link" onClick={resource.refresh}>
          Refresh
        </button>
      </div>
      <p>
        Conversations about the Ara Ara collection, shared with Yoru. Open a story to comment,
        reply, or create a room with friends.
      </p>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorNotice message={resource.error} retry={resource.refresh} />
      ) : items.length ? (
        <div className="ara-feed">
          {items.map((item) => (
            <article key={`${item.kind}:${item.id}`}>
              <div className="ara-feed-byline">
                <Avatar user={item.author} />
                <strong>{item.author?.name || 'Member'}</strong>
                <small>{ago(item.createdAt)}</small>
              </div>
              <Link
                to={`/ara-ara/title/${item.mediaId}${item.kind === 'review' ? '?tab=reviews' : item.unit ? `?unit=${item.unit}` : ''}`}
              >
                <h3>
                  {titleOf(item.media)}
                  {item.unit
                    ? ` · ${isAnime(item.media) ? 'Episode' : 'Chapter'} ${item.unit}`
                    : ''}
                </h3>
                <p>
                  {item.spoiler
                    ? 'Spoilers inside. Open the discussion to read.'
                    : commentPreview(item.body)}
                </p>
                <span className="text-link">
                  Join the conversation <ArrowRight size={14} />
                </span>
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <Empty icon={MessageCircle} title="Start the first conversation">
          Choose a story below and share your thoughts.
        </Empty>
      )}
      <div className="ara-community-stories">
        {titles.map((media) => (
          <Link key={media.id} to={`/ara-ara/title/${media.id}`}>
            <CoverImage media={media} alt="" />
            <span>{titleOf(media)}</span>
            <ArrowRight size={15} />
          </Link>
        ))}
      </div>
    </section>
  );
}
