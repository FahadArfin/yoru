import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Play,
  Plus,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';
import { useApp, useResource } from '../state';
import {
  ago,
  bannerOf,
  coverOf,
  isAnime,
  itemsOf,
  kindOf,
  plainText,
  scoreOf,
  titleOf,
} from '../api';
import {
  Avatar,
  Badge,
  Empty,
  ErrorNotice,
  Loading,
  Poster,
  PosterRail,
  Section,
} from '../components';
export default function Home() {
  const anime = useResource('/api/catalog?category=ANIME&curated=1');
  const manga = useResource('/api/catalog?category=MANGA&curated=1');
  const manhwa = useResource('/api/catalog?category=MANHWA&curated=1');
  const feed = useResource('/api/community', false);
  const rooms = useResource('/api/rooms', false);
  const { user, library, updateEntry, entryFor, online, event } = useApp();
  useEffect(() => {
    if (['comments', 'reviews', 'snapshot'].includes(event?.type)) feed.refresh();
    if (['rooms', 'snapshot'].includes(event?.type)) rooms.refresh();
  }, [event]);
  const [heroIndex, setHeroIndex] = useState(0);
  const [tab, setTab] = useState('ANIME');
  const animeItems = itemsOf(anime.data),
    mangaItems = itemsOf(manga.data),
    manhwaItems = itemsOf(manhwa.data);
  const featured = useMemo(
    () =>
      [
        animeItems.find((m) => m.id === 'mal-anime-52991') || animeItems[0],
        animeItems.find((m) => m.id === 'mal-anime-52299') || animeItems[1],
        manhwaItems.find((m) => m.id === 'mal-manga-121496') || manhwaItems[0],
        mangaItems[0],
      ].filter(Boolean),
    [anime.data, manga.data, manhwa.data],
  );
  const hero = featured[heroIndex % (featured.length || 1)];
  const current = tab === 'ANIME' ? anime : tab === 'MANGA' ? manga : manhwa;
  const inProgress = library.filter(
    (item) =>
      item.media &&
      (item.status === 'watching' || item.status === 'reading' || item.status === 'current') &&
      item.progress > 0,
  );
  return (
    <div className="page home-page">
      <div className="greeting">
        <div>
          <span className="eyebrow">THE GOOD KIND OF ESCAPE</span>
          <h1>
            {user ? `Good to see you, ${user.name}.` : 'Welcome to your universe.'}
            <span className="greeting-star">✦</span>
          </h1>
        </div>
        <span className="greeting-note">Watch. Read. Get a little carried away.</span>
      </div>
      {hero ? (
        <section className="hero" aria-label="Featured story">
          <img
            key={hero.id}
            className="hero-art"
            src={bannerOf(hero)}
            alt={titleOf(hero)}
            fetchPriority="high"
            onError={(e) => {
              const img = e.currentTarget;
              if (img.dataset.fallback === 'icon') return;
              img.src = img.dataset.fallback ? '/icon.svg' : coverOf(hero);
              img.dataset.fallback = img.dataset.fallback ? 'icon' : 'cover';
            }}
          />
          <div className="hero-grain" />
          <div className="hero-content">
            <div className="hero-eyebrow">
              <span className="feature-line" />
              <Sparkles size={14} />
              {isAnime(hero) ? 'TONIGHT’S SPOTLIGHT' : 'YOUR NEXT PAGE-TURNER'}
            </div>
            <div className="hero-tags">
              <Badge tone="violet">{kindOf(hero)}</Badge>
              <span>{hero.year}</span>
              <span className="dot" />
              <span>{hero.genres?.slice(0, 2).join(' · ')}</span>
            </div>
            <h2>{titleOf(hero)}</h2>
            <p>
              {plainText(hero.description).slice(0, 200)}
              {plainText(hero.description).length > 200 ? '…' : ''}
            </p>
            <div className="hero-meta">
              <span>
                <Star size={15} fill="currentColor" />
                {scoreOf(hero).toFixed(1)}{' '}
                <small>{hero.source === 'Kitsu' ? 'Kitsu' : 'MAL'}</small>
              </span>
              <span>
                {hero.episodes
                  ? `${hero.episodes} episodes`
                  : hero.chapters
                    ? `${hero.chapters} chapters`
                    : 'Ongoing story'}
              </span>
              <span>
                {String(hero.status || '')
                  .replaceAll('_', ' ')
                  .toLowerCase()}
              </span>
            </div>
            <div className="hero-actions">
              <Link className="btn btn-primary" to={`/title/${hero.id}`}>
                {isAnime(hero) ? <Play size={17} fill="currentColor" /> : <BookOpen size={18} />}
                Explore {isAnime(hero) ? 'series' : 'story'}
              </Link>
              <button
                className="btn btn-glass"
                onClick={() => updateEntry(hero, { status: entryFor(hero)?.status || 'planned' })}
              >
                <Plus size={18} />
                {entryFor(hero) ? 'In your library' : 'Add to list'}
              </button>
            </div>
          </div>
          <div className="hero-bottom">
            <span className="hero-credit">A STORY WORTH STAYING UP FOR</span>
            <div className="hero-slider">
              <button
                aria-label="Previous featured title"
                onClick={() => setHeroIndex((i) => (i - 1 + featured.length) % featured.length)}
              >
                <ChevronLeft size={18} />
              </button>
              {featured.map((m, i) => (
                <button
                  key={m.id}
                  aria-label={`Feature ${titleOf(m)}`}
                  aria-current={i === heroIndex}
                  onClick={() => setHeroIndex(i)}
                  className={`slide-dot ${i === heroIndex ? 'selected' : ''}`}
                />
              ))}
              <span>
                {String(heroIndex + 1).padStart(2, '0')}
                <small> / {String(featured.length).padStart(2, '0')}</small>
              </span>
              <button
                aria-label="Next featured title"
                onClick={() => setHeroIndex((i) => (i + 1) % featured.length)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </section>
      ) : anime.error ? (
        <ErrorNotice message={anime.error} retry={anime.refresh} />
      ) : (
        <div className="hero hero-skeleton">
          <Loading />
        </div>
      )}
      <div className="discovery-ribbon">
        <span className="ribbon-icon">
          <Users size={21} />
        </span>
        <div>
          <strong>Your people are one story away.</strong>
          <span>Find a room, share a theory, or just enjoy the quiet company.</span>
        </div>
        <Link to="/rooms">
          Let’s hang out <ArrowUpRight size={17} />
        </Link>
        <span className="ribbon-orbit" />
      </div>
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
                    {isAnime(entry.media) ? 'Episode' : 'Chapter'} {entry.progress} · Pick it back
                    up
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
            eyebrow="THE STORIES EVERYONE’S TALKING ABOUT"
            title="Find your next obsession"
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
                    {category === 'MANHWA' ? 'Manhwa' : category === 'MANGA' ? 'Manga' : 'Anime'}
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
          <Section eyebrow="JUST ONE MORE CHAPTER" title="Beyond the screen" href="/browse/manhwa">
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
        <aside className="home-community">
          <div className="community-heading">
            <span className="tiny-icon">
              <MessageCircle size={16} />
            </span>
            <h2>The common room</h2>
            <span className="live-dot" />
          </div>
          <p className="community-subtitle">Good stories start conversations.</p>
          <div className="community-count">
            <div className="avatar-stack">
              {(online.users || []).slice(0, 3).map((u) => (
                <Avatar key={u.id} user={u} size="small" />
              ))}
            </div>
            <span>
              <strong>{online.count || 0}</strong> here with you
            </span>
          </div>
          <div className="mini-feed">
            {itemsOf(feed.data).length ? (
              itemsOf(feed.data)
                .slice(0, 3)
                .map((item) => (
                  <Link
                    key={item.id}
                    to={`/title/${item.mediaId}${item.kind === 'review' ? '?tab=reviews' : item.unit ? `?unit=${item.unit}` : ''}`}
                    className="mini-post"
                  >
                    <div>
                      <Avatar
                        user={item.author || item.user || { name: item.userName || item.name }}
                        size="small"
                      />
                      <strong>
                        {item.author?.name ||
                          item.user?.name ||
                          item.userName ||
                          item.name ||
                          'Member'}
                      </strong>
                      <small>{ago(item.createdAt)}</small>
                    </div>
                    <p>
                      {item.spoiler
                        ? 'A spoiler-filled take. Open the discussion to reveal.'
                        : item.body?.slice(0, 115)}
                    </p>
                    <span>
                      {item.media ? titleOf(item.media) : 'Community discussion'}
                      {item.unit ? ` · ${isAnime(item.media) ? 'Ep' : 'Ch'} ${item.unit}` : ''}
                    </span>
                  </Link>
                ))
            ) : (
              <div className="first-conversation">
                <span>“</span>
                <h3>
                  Every fandom starts
                  <br />
                  with a conversation.
                </h3>
                <p>Found your new favorite? Tell us what makes it worth the hype.</p>
              </div>
            )}
          </div>
          <Link to="/community" className="btn btn-subtle community-link">
            Join the conversation <ArrowRight size={16} />
          </Link>
          <div className="sidebar-room-card">
            <span className="eyebrow">
              <span className="live-dot" />
              ROOMS, REAL COMPANY
            </span>
            <Users size={33} />
            <h3>
              {itemsOf(rooms.data).length
                ? `${itemsOf(rooms.data).length} rooms to discover`
                : 'Save a seat for someone.'}
            </h3>
            <p>Watch an episode or read a chapter, together.</p>
            <Link to="/rooms">
              Find a room <ArrowUpRight size={15} />
            </Link>
          </div>
        </aside>
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
  );
}
