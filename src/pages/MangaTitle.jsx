import RoomLauncher from '../RoomLauncher';
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from '../collection-router';
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ExternalLink,
  Heart,
  Plus,
  Star,
  Users,
} from 'lucide-react';
import { kindOf, plainText, safeLink, scoreOf, titleOf } from '../api';
import { useApp } from '../state';
import { Button } from '../components';
import Discussion, { Reviews } from '../Discussion';
import { ChapterCollection } from '../reader/ReadingCollection';
import { useReadingState } from '../reader/hooks';
import { readerLink } from '../reader/model';
import MangaRecommendations from './MangaRecommendations';
import CoverImage from '../CoverImage';
import PrefetchLink from '../PrefetchLink';
import './manga-title.css';
import { parseEditionReference } from '../../shared/media-reference';

function SourceLinks({ title, links }) {
  if (!links.length) return null;
  return (
    <section className="manga-fact">
      <h3>{title}</h3>
      <div className="manga-fact-links">
        {links.map((link, i) => (
          <a key={i} href={safeLink(link.url)} target="_blank" rel="noopener noreferrer">
            {link.label || link.name || 'Visit source'}
            <ExternalLink size={11} />
          </a>
        ))}
      </div>
    </section>
  );
}

export default function MangaTitle({ media }) {
  const { entryFor, updateEntry } = useApp();
  const entry = entryFor(media.id);
  const reading = useReadingState(media.id);
  const [params, setParams] = useSearchParams();
  const tab = params.has('unit')
    ? 'discussion'
    : params.get('tab') === 'reviews'
      ? 'reviews'
      : 'chapters';
  const reference = parseEditionReference(params.get('edition'));
  const edition = reference?.id;
  const requestedUnit = Number(params.get('unit')) || 0;
  const unit = Math.max(
    0,
    Math.min(100000, reference?.kind === 'extension' ? requestedUnit : Math.trunc(requestedUnit)),
  );
  const chapterLabel = edition ? params.get('chapter')?.slice(0, 80) : null;
  const discussion = useRef({ unit, edition, chapterLabel });
  if (params.has('unit')) discussion.current = { unit, edition, chapterLabel };
  const discussionHeading =
    edition && chapterLabel
      ? chapterLabel === 'Special chapter'
        ? 'Special chapter discussion'
        : `Chapter ${chapterLabel} discussion`
      : unit > 0 || edition
        ? `Chapter ${unit} discussion`
        : 'Title discussion';
  useEffect(() => {
    if (tab === 'discussion' && window.location.hash === '#chapter-discussion') {
      document.getElementById('chapter-discussion')?.focus();
    }
  }, [tab, unit, edition]);
  const [progress, setProgress] = useState(entry?.progress || 0);
  const dirty = useRef(false);
  const [expandedStory, setExpandedStory] = useState(false);
  const [storyOverflows, setStoryOverflows] = useState(false);
  const storyRef = useRef(null);
  useEffect(() => {
    if (!dirty.current) setProgress(entry?.progress || 0);
  }, [entry?.progress]);
  const category = kindOf(media).toLowerCase();
  const title = titleOf(media);
  const alternativeTitles = [
    ...new Set(
      [
        media.titleEnglish,
        media.titleRomaji,
        media.titleNative,
        media.titleJapanese,
        ...(media.synonyms || []),
      ].filter(Boolean),
    ),
  ];
  const subtitle = alternativeTitles.find((t) => t !== title);
  const links = (media.externalLinks || []).filter((link) => safeLink(link.url));
  const readingLinks = links.filter(
    (link) =>
      ['reading', 'streaming', 'official'].includes(link.type) ||
      /official|manga plus|webtoon|book|viz|comikey|tapas|tappytoon/i.test(link.label || ''),
  );
  const trackingLinks = links.filter((link) => !readingLinks.includes(link));
  const watchPath = reading.lastChapter
    ? readerLink(
        media.id,
        { id: reading.lastChapter, number: reading.number },
        reading.chapters[reading.lastChapter]?.page,
      )
    : `/read/${media.id}/${Math.max(1, entry?.progress || 1)}`;
  const description =
    plainText(media.description) || 'A synopsis is not available for this title yet.';
  useEffect(() => {
    const element = storyRef.current;
    if (!element || expandedStory) return;
    const measure = () => setStoryOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [description, expandedStory]);
  const status = String(media.status || 'Unknown').replaceAll('_', ' ');
  const native = /^ext-manga-[a-f0-9]{32}$/.test(media.id);
  const metadataSource = native
    ? media.sourceRef?.providerKey || 'Source catalog'
    : media.source === 'Kitsu'
      ? 'Kitsu'
      : 'MyAnimeList';
  return (
    <div className="manga-title-page">
      <div className="manga-title-container">
        <Link className="manga-back" to={`/browse/${category}`}>
          <ArrowLeft size={15} />
          Back to {category}
        </Link>
        <header className="manga-title-header">
          <CoverImage
            className="manga-detail-cover"
            media={media}
            alt={`${title} cover`}
            loading="eager"
            fetchPriority="high"
          />
          <div className="manga-title-heading">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="manga-title-credits">
            {media.authors?.join(' · ') || <span>{media.format || kindOf(media)}</span>}
          </div>
          <div className="manga-title-actions">
            <Button
              variant="secondary"
              onClick={() => updateEntry(media, { status: entry?.status || 'planned' })}
            >
              {entry ? <Check size={18} /> : <Plus size={18} />}{' '}
              {entry ? 'In your library' : 'Add to library'}
            </Button>
            <PrefetchLink className="btn btn-secondary" to={watchPath}>
              <BookOpen size={19} />
              {reading.lastChapter ? 'Continue reading' : 'Open reader'}
            </PrefetchLink>
            <button
              className={`btn btn-secondary ${entry?.favorite ? 'favorited' : ''}`}
              aria-label={entry?.favorite ? 'Remove from favorites' : 'Add to favorites'}
              onClick={() =>
                updateEntry(media, {
                  favorite: !entry?.favorite,
                  status: entry?.status || 'planned',
                })
              }
            >
              <Heart size={18} fill={entry?.favorite ? 'currentColor' : 'none'} />
              <span>Favorite</span>
            </button>
            <RoomLauncher media={media} />
          </div>
          <div className="manga-title-tags">
            {media.genres?.slice(0, 8).map((genre) => (
              <Link key={genre} to={`/browse/${category}?genre=${encodeURIComponent(genre)}`}>
                {genre}
              </Link>
            ))}
            <span className="manga-publication">
              <i className={/finish|complet/i.test(status) ? 'complete' : ''} />
              Publication: {media.year ? `${media.year}, ` : ''}
              {status}
            </span>
          </div>
          <div className="manga-title-stats">
            <span className="manga-score" title={`${metadataSource} title rating`}>
              <Star size={16} />
              {scoreOf(media) > 0 ? scoreOf(media).toFixed(2) : 'Unrated'}
              <small>{native ? metadataSource : media.source === 'Kitsu' ? 'Kitsu' : 'MAL'}</small>
            </span>
            {media.members > 0 && (
              <span title={`Readers listed on ${metadataSource}`}>
                <Bookmark size={15} />
                {Number(media.members).toLocaleString()}
                <small>
                  {native ? metadataSource : metadataSource === 'Kitsu' ? 'Kitsu' : 'MAL'} readers
                </small>
              </span>
            )}
            {media.chapters > 0 && (
              <span>
                <BookOpen size={15} />
                {media.chapters}
                <small>chapters</small>
              </span>
            )}
            {media.volumes > 0 && (
              <span>
                {media.volumes}
                <small>volumes</small>
              </span>
            )}
          </div>
        </header>
        <section className="manga-synopsis" aria-label="Synopsis">
          <p ref={storyRef} className={expandedStory ? '' : 'collapsed-story'}>
            {description}
          </p>
          {(storyOverflows || expandedStory) && (
            <button onClick={() => setExpandedStory(!expandedStory)} aria-expanded={expandedStory}>
              {expandedStory ? 'Show less' : 'Read more'}
              <ChevronDown size={13} />
            </button>
          )}
        </section>
        <div className="manga-section-tabs" role="tablist" aria-label="Title sections">
          {[
            ['chapters', 'Chapters'],
            ['discussion', 'Discussion'],
            ['reviews', 'Reviews'],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'active' : ''}
              onClick={() =>
                setParams(
                  key === 'discussion'
                    ? {
                        unit: String(discussion.current.unit),
                        ...(discussion.current.edition
                          ? { edition: discussion.current.edition }
                          : {}),
                        ...(discussion.current.chapterLabel
                          ? { chapter: discussion.current.chapterLabel }
                          : {}),
                      }
                    : { tab: key },
                )
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="manga-details-layout">
          <aside className="manga-metadata" aria-label="Manga details">
            {media.authors?.length > 0 && (
              <section className="manga-fact">
                <h3>Authors</h3>
                <div className="manga-fact-links">
                  {media.authors.map((author) => (
                    <span key={author}>{author}</span>
                  ))}
                </div>
              </section>
            )}
            {!!media.genres?.length && (
              <section className="manga-fact">
                <h3>Genres & themes</h3>
                <div className="manga-fact-links">
                  {media.genres.map((genre) => (
                    <Link key={genre} to={`/browse/${category}?genre=${encodeURIComponent(genre)}`}>
                      {genre}
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <section className="manga-fact">
              <h3>Publication</h3>
              <div className="manga-fact-links">
                <span>{kindOf(media)}</span>
                <span>{status}</span>
                {media.year && <span>{media.year}</span>}
              </div>
            </section>
            <SourceLinks title="Read or buy" links={readingLinks} />
            <SourceLinks title="Track" links={trackingLinks} />
            <MangaRecommendations media={media} />
            <details className="manga-progress">
              <summary>
                <Bookmark size={15} />
                My reading progress
                <ChevronDown size={14} />
              </summary>
              <div className="tracking-panel">
                <label>
                  My status
                  <select
                    aria-label="My status"
                    value={entry?.status || 'planned'}
                    onChange={(e) => updateEntry(media, { status: e.target.value })}
                  >
                    <option value="planned">Plan to read</option>
                    <option value="reading">Reading</option>
                    <option value="completed">Completed</option>
                    <option value="paused">On hold</option>
                    <option value="dropped">Dropped</option>
                  </select>
                </label>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const saved = await updateEntry(media, {
                      progress: Number(progress),
                      status: entry?.status === 'completed' ? 'completed' : 'reading',
                    });
                    if (saved) dirty.current = false;
                  }}
                >
                  <label>
                    Chapter progress
                    <input
                      aria-label="Progress"
                      type="number"
                      min="0"
                      max={media.chapters || 100000}
                      value={progress}
                      onChange={(e) => {
                        dirty.current = true;
                        setProgress(e.target.value);
                      }}
                    />
                  </label>
                  <Button variant="subtle" type="submit">
                    Save progress
                    <Check size={14} />
                  </Button>
                </form>
                <small className="saved-note">
                  {entry
                    ? 'Saved to your account.'
                    : 'Sign in to save your progress across devices.'}
                </small>
              </div>
            </details>
          </aside>
          <div className="manga-tab-content" id="manga-chapters">
            {tab === 'chapters' && <ChapterCollection media={media} />}
            {tab === 'discussion' && (
              <section
                id="chapter-discussion"
                className="chapter-discussion-panel"
                tabIndex={-1}
                aria-label={discussionHeading}
              >
                <h2>
                  {title} — {discussionHeading}
                </h2>
                <Link className="text-link" to={`/title/${media.id}?tab=chapters#manga-chapters`}>
                  <ArrowLeft size={16} /> Back to chapters
                </Link>
                {!edition && (
                  <label className="unit-picker">
                    Chapter
                    <input
                      aria-label="Discussion chapter"
                      type="number"
                      min="0"
                      max={media.chapters || 100000}
                      value={unit}
                      onChange={(e) =>
                        setParams({
                          unit: String(
                            Math.max(0, Math.min(100000, Math.trunc(Number(e.target.value) || 0))),
                          ),
                        })
                      }
                    />
                  </label>
                )}
                {unit === 0 && !edition && <p className="muted">Discussion for the whole title.</p>}
                <Discussion
                  key={`${media.id}-${unit}-${edition || ''}`}
                  mediaId={media.id}
                  media={media}
                  unit={unit}
                  edition={edition}
                />
              </section>
            )}
            {tab === 'reviews' && <Reviews mediaId={media.id} />}
          </div>
        </div>
      </div>
    </div>
  );
}
