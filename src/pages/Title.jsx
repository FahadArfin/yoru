import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  Check,
  ExternalLink,
  Heart,
  MessageCircle,
  Play,
  Plus,
  Star,
  Users,
} from 'lucide-react';
import { bannerOf, coverOf, isAnime, kindOf, plainText, safeLink, scoreOf, titleOf } from '../api';
import { useApp, useResource } from '../state';
import { Badge, Button, ErrorNotice, Loading } from '../components';
import Discussion, { Reviews } from '../Discussion';
import { ChapterCollection } from '../reader/ReadingCollection';
import { useReadingState } from '../reader/hooks';
import { readerLink } from '../reader/model';
import MangaTitle from './MangaTitle';
import MangaRecommendations from './MangaRecommendations';
const selectedTab = (params) =>
  params.get('unit')
    ? 'discussion'
    : { chapters: 'units', episodes: 'units', reviews: 'reviews' }[params.get('tab')] || 'overview';
export default function Title() {
  const { id } = useParams();
  const readingState = useReadingState(id);
  const [params, setParams] = useSearchParams();
  const resource = useResource(`/api/media/${id}`);
  const media = resource.data?.media || resource.data;
  const { entryFor, updateEntry } = useApp();
  const entry = entryFor(id);
  const [tab, setTab] = useState(() => selectedTab(params));
  const [unitPage, setUnitPage] = useState(0);
  const progressDirty = useRef(false);
  const [progress, setProgress] = useState(entry?.progress || 0);
  const unit =
    params.get('unit') === '0'
      ? 0
      : Math.max(1, Math.min(100000, Math.trunc(Number(params.get('unit')) || 1)));
  useEffect(() => {
    if (!progressDirty.current) setProgress(entry?.progress || 0);
  }, [entry?.progress]);
  useEffect(() => {
    progressDirty.current = false;
    setProgress(entry?.progress || 0);
  }, [id]);
  useEffect(() => {
    setTab(selectedTab(params));
    setUnitPage(0);
  }, [id, params.get('unit'), params.get('tab')]);
  useEffect(() => {
    if (media) document.title = `${titleOf(media)} · Yoru`;
    return () => {
      document.title = 'Yoru · A little more obsessed';
    };
  }, [media]);
  if (resource.loading) return <Loading />;
  if (resource.error || !media)
    return (
      <div className="page">
        <ErrorNotice
          message={resource.error || 'This title could not be found.'}
          retry={resource.refresh}
        />
      </div>
    );
  const anime = isAnime(media);
  if (!anime) return <MangaTitle key={id} media={media} />;
  const knownTotal = anime ? media.episodes : media.chapters;
  const startUnit = Math.max(1, entry?.progress || 1);
  const watchPath =
    !anime && readingState.lastChapter
      ? readerLink(
          id,
          { id: readingState.lastChapter, number: readingState.number },
          readingState.chapters[readingState.lastChapter]?.page,
        )
      : `/${anime ? 'watch' : 'read'}/${id}/${startUnit}`;
  const unitName = anime ? 'Episode' : 'Chapter';
  return (
    <div className="title-page">
      <div className="title-backdrop">
        <img src={bannerOf(media)} alt="" />
        <div />
        <Link className="back-link" to={`/browse/${kindOf(media).toLowerCase()}`}>
          <ArrowLeft size={16} />
          Back to {kindOf(media).toLowerCase()}
        </Link>
      </div>
      <div className="page title-main">
        <div className="title-intro">
          <img className="detail-poster" src={coverOf(media)} alt={titleOf(media)} />
          <div className="title-summary">
            <div className="hero-tags">
              <Badge tone="violet">{kindOf(media)}</Badge>
              <span>{media.year}</span>
              <span className="dot" />
              <span>{String(media.status || '').replaceAll('_', ' ')}</span>
            </div>
            <h1>{titleOf(media)}</h1>
            <p className="native-title">
              {media.titleRomaji !== titleOf(media) ? media.titleRomaji : media.titleJapanese || ''}
            </p>
            <div className="title-stats">
              <span className="detail-score">
                <Star size={17} fill="currentColor" />
                <strong>{scoreOf(media).toFixed(2)}</strong>
                <small>{media.source === 'Kitsu' ? 'Kitsu' : 'MyAnimeList'}</small>
              </span>
              <span>
                {knownTotal || '—'}
                <small>{anime ? 'Episodes' : 'Chapters'}</small>
              </span>
              <span>
                {media.format || (anime ? 'TV' : 'Comic')}
                <small>Format</small>
              </span>
            </div>
            <div className="detail-actions">
              <Link className="btn btn-primary" to={watchPath}>
                {anime ? <Play size={17} fill="currentColor" /> : <BookOpen size={18} />}{' '}
                {anime
                  ? 'Watch & discuss'
                  : readingState.lastChapter
                    ? 'Continue reading'
                    : 'Open reader'}
              </Link>
              <Button
                variant="secondary"
                onClick={() => updateEntry(media, { status: entry?.status || 'planned' })}
              >
                {entry ? <Check size={17} /> : <Plus size={17} />}
                {entry ? 'In your library' : 'Add to list'}
              </Button>
              <button
                className={`btn btn-secondary icon-square ${entry?.favorite ? 'favorited' : ''}`}
                onClick={() =>
                  updateEntry(media, {
                    favorite: !entry?.favorite,
                    status: entry?.status || 'planned',
                  })
                }
                aria-label={entry?.favorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart size={19} fill={entry?.favorite ? 'currentColor' : 'none'} />
              </button>
              <Link className="btn btn-secondary" to={`/rooms?media=${id}`}>
                <Users size={18} />
                Enjoy together
              </Link>
            </div>
          </div>
        </div>
        <div className="detail-layout">
          <div>
            <div className="detail-tabs" role="tablist" aria-label="Title sections">
              {[
                ['overview', 'Overview'],
                ['units', anime ? 'Episodes' : 'Chapters'],
                ['discussion', 'Discussion'],
                ['reviews', 'Reviews'],
              ].map(([key, label]) => (
                <button
                  role="tab"
                  aria-selected={tab === key}
                  className={tab === key ? 'active' : ''}
                  key={key}
                  onClick={() => {
                    setTab(key);
                    setParams(
                      key === 'units'
                        ? { tab: anime ? 'episodes' : 'chapters' }
                        : key === 'reviews'
                          ? { tab: 'reviews' }
                          : key === 'discussion'
                            ? { unit: params.get('unit') || '0' }
                            : {},
                    );
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === 'overview' && (
              <section className="overview">
                <span className="eyebrow">THE STORY</span>
                <h2>A new world to get lost in.</h2>
                <p>
                  {plainText(media.description) ||
                    'A synopsis is not available for this title yet.'}
                </p>
                <div className="genre-chips">
                  {media.genres?.map((genre) => (
                    <Link
                      to={`/browse/${kindOf(media).toLowerCase()}?genre=${encodeURIComponent(genre)}`}
                      key={genre}
                    >
                      {genre}
                    </Link>
                  ))}
                </div>
                <div className="title-companion">
                  <MessageCircle size={28} />
                  <div>
                    <h3>Some stories need a group chat.</h3>
                    <p>Open an episode or chapter for spoiler-aware discussions.</p>
                  </div>
                  <Button variant="subtle" onClick={() => setTab('discussion')}>
                    Join in <ArrowRight size={16} />
                  </Button>
                </div>
                {media.trailer?.url && safeLink(media.trailer.url) && (
                  <a
                    className="text-link"
                    href={safeLink(media.trailer.url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Watch the official trailer <ExternalLink size={14} />
                  </a>
                )}
              </section>
            )}
            {['overview', 'units'].includes(tab) && !anime && (
              <ChapterCollection key={id} media={media} />
            )}
            {tab === 'units' && anime && (
              <section>
                <div className="section-heading">
                  <h2>{anime ? 'Episode guide' : 'Your next chapter'}</h2>
                  <span className="muted">
                    {knownTotal
                      ? `${knownTotal} ${anime ? 'episodes' : 'chapters'}`
                      : 'Ongoing · enter a number below'}
                  </span>
                </div>
                <p className="muted">
                  Choose a discussion or open a source. External provider availability can vary.
                </p>
                <div className="unit-grid">
                  {Array.from(
                    {
                      length: knownTotal
                        ? Math.min(50, Math.max(0, knownTotal - unitPage * 50))
                        : 50,
                    },
                    (_, i) => i + 1 + unitPage * 50,
                  ).map((number) => (
                    <Link
                      key={number}
                      to={`/${anime ? 'watch' : 'read'}/${id}/${number}`}
                      className={number <= (entry?.progress || 0) ? 'completed' : ''}
                    >
                      <span>
                        {number <= (entry?.progress || 0) ? (
                          <Check size={13} />
                        ) : anime ? (
                          <Play size={12} />
                        ) : (
                          <BookOpen size={13} />
                        )}
                      </span>
                      {unitName} {number}
                    </Link>
                  ))}
                </div>
                <div className="pagination">
                  <button disabled={!unitPage} onClick={() => setUnitPage((n) => n - 1)}>
                    <ArrowLeft size={15} />
                    Previous
                  </button>
                  <span>
                    {unitPage * 50 + 1}–
                    {knownTotal ? Math.min(knownTotal, (unitPage + 1) * 50) : unitPage * 50 + 50}
                  </span>
                  <button
                    disabled={Boolean(knownTotal && (unitPage + 1) * 50 >= knownTotal)}
                    onClick={() => setUnitPage((n) => n + 1)}
                  >
                    Next
                    <ArrowRight size={15} />
                  </button>
                </div>
              </section>
            )}
            {tab === 'discussion' && (
              <>
                {unit === 0 && <p className="muted">Discussion for the whole title.</p>}
                <label className="unit-picker">
                  {unitName}
                  <input
                    aria-label={`Discussion ${unitName.toLowerCase()}`}
                    type="number"
                    min="0"
                    max={knownTotal || 100000}
                    value={unit}
                    onChange={(e) =>
                      setParams({
                        unit: Math.max(
                          0,
                          Math.min(100000, Math.trunc(Number(e.target.value) || 0)),
                        ),
                      })
                    }
                  />
                </label>
                <Discussion key={`${id}-${unit}`} mediaId={id} unit={unit} />
              </>
            )}
            {tab === 'reviews' && <Reviews mediaId={id} />}
          </div>
          <aside className="detail-aside">
            <MangaRecommendations key={id} media={media} />
            <div className="panel tracking-panel">
              <div className="panel-heading">
                <Bookmark size={18} />
                <h3>Keep your place</h3>
                {entry && <Check size={14} className="saved-check" />}
              </div>
              <label>
                My status
                <select
                  aria-label="My status"
                  value={entry?.status || 'planned'}
                  onChange={(e) => updateEntry(media, { status: e.target.value })}
                >
                  <option value="planned">Plan to {anime ? 'watch' : 'read'}</option>
                  <option value={anime ? 'watching' : 'reading'}>
                    {anime ? 'Watching' : 'Reading'}
                  </option>
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
                    status:
                      entry?.status === 'completed' ? 'completed' : anime ? 'watching' : 'reading',
                  });
                  if (saved) progressDirty.current = false;
                }}
              >
                <label>
                  {unitName} progress
                  <input
                    type="number"
                    aria-label="Progress"
                    min="0"
                    max={knownTotal || 100000}
                    value={progress}
                    onChange={(e) => {
                      progressDirty.current = true;
                      setProgress(e.target.value);
                    }}
                  />
                </label>
                <Button variant="subtle" type="submit">
                  Save progress <Check size={14} />
                </Button>
              </form>
              <small className="saved-note">
                {entry
                  ? 'Saved to your account. Pick up on any device.'
                  : 'Sign in to save your progress across devices.'}
              </small>
            </div>
            <div className="panel source-panel">
              <span className="eyebrow">OFF THE PAGE</span>
              <h3>Explore this title</h3>
              {(media.externalLinks || [])
                .filter((source) => safeLink(source.url))
                .map((source, i) => (
                  <a key={i} href={safeLink(source.url)} target="_blank" rel="noreferrer">
                    {source.label || source.name || 'Visit source'}
                    <ExternalLink size={14} />
                  </a>
                ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
