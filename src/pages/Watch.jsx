import RoomLauncher from '../RoomLauncher';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from '../collection-router';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ExternalLink,
  Link2,
  MonitorPlay,
  Play,
  Plus,
  Users,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  List,
  Monitor,
  SkipForward,
  CirclePlay,
  MessageSquare,
  Mic,
} from 'lucide-react';
import { bannerOf, isAnime, safeLink, titleOf } from '../api';
import { recordView } from '../watch-views';
import { useApp, useResource } from '../state';
import { Button, Empty, ErrorNotice, Loading } from '../components';
import SourcePlayer from '../SourcePlayer';
import ChromecastControls from '../ChromecastControls';
import Discussion from '../Discussion';
import { ExternalPlayer, SourceForm } from '../Playback';
import { defaultAnimeSources } from '../../shared/anime-sources';
import { setWatchPage } from '../webmcp-state';
import '../watch.css';
import WatchDetails from '../WatchDetails';
import AnimeCast from '../AnimeCast';
import WatchEpisodePreview from '../WatchEpisodePreview';
import useEpisodeAvailability from '../useEpisodeAvailability';
const readSource = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || null;
  } catch {
    return null;
  }
};
function WatchSession() {
  const { id, unit: unitParam } = useParams();
  const navigate = useNavigate();
  const unit = Math.max(1, Number(unitParam) || 1);
  const resource = useResource(`/api/media/${id}`);
  const media = resource.data?.media || resource.data;
  const { entryFor, updateEntry, notify, user, resumeItems, saveResume } = useApp();
  const entry = entryFor(id);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const language = params.get('language') === 'dub' ? 'dub' : 'sub';
  const selected = params.get('source') || '';
  const setSelected = (value) =>
    setParams(
      (old) => {
        old.set('source', value);
        return old;
      },
      { replace: true },
    );
  const setLanguage = (value) =>
    setParams(
      (old) => {
        old.set('language', value);
        return old;
      },
      { replace: true },
    );
  const [custom, setCustom] = useState(() => readSource(`yoru:source:${id}`));
  const [unitDraft, setUnitDraft] = useState(unit);
  const [resume, setResume] = useState(0);
  const [playerSaved, setPlayerSaved] = useState(false);
  const [episodeView, setEpisodeView] = useState(() =>
    readSource('yoru:episode-view') === 'list' ? 'list' : 'tiles',
  );
  const [theater, setTheater] = useState(false);
  const [autoplay, setAutoplay] = useState(() => readSource('yoru:watch-autoplay') === true);
  const [autoNext, setAutoNext] = useState(() => readSource('yoru:watch-auto-next') === true);
  const [episodeGroup, setEpisodeGroup] = useState(Math.floor((unit - 1) / 50));
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const endedRef = useRef(false);
  const videoRef = useRef(null);
  const positionRef = useRef(0);
  const savePreference = (key, value, setter) => {
    setter(value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };
  useEffect(() => {
    setCustom(readSource(`yoru:source:${id}`));
  }, [id]);
  useEffect(() => {
    setUnitDraft(unit);
    const saved = resumeItems.find((item) => item.mediaId === id && item.number === unit);
    positionRef.current =
      saved?.position || (!user ? Number(readSource(`yoru:position:${id}:${unit}`)) || 0 : 0);
    setResume(positionRef.current);
    setPlayerSaved(false);
    setEpisodeGroup(Math.floor((unit - 1) / 50));
    endedRef.current = false;
  }, [id, unit]);
  const anime = isAnime(media);
  useEffect(() => {
    if (
      (!anime && !['MANGA', 'MANHWA'].includes(media?.category)) ||
      media?.id !== id ||
      resource.loading ||
      resource.error
    )
      return;
    let recorded = false;
    const record = () => {
      if (recorded || document.hidden) return;
      recorded = true;
      recordView(id, !anime).catch(() => {});
    };
    record();
    document.addEventListener('visibilitychange', record);
    return () => document.removeEventListener('visibilitychange', record);
  }, [id, anime, media?.id, media?.category, resource.loading, resource.error]);
  const total = anime ? media?.episodes : media?.chapters;
  const episodeDetails = useResource(
    anime ? `/api/media/${id}/episodes?page=${Math.floor(episodeGroup / 2) + 1}` : null,
  );
  const episodeByNumber = new Map(
    (episodeDetails.data?.items || []).map((item) => [item.number, item]),
  );
  const availability = useEpisodeAvailability(media, episodeDetails.data);
  const unreleased = anime && availability.state(unit) === 'unreleased';
  const blocked = availability.loading || unreleased;
  const automatic = useResource(
    anime && !blocked ? `/api/media/${id}/sources?episode=${unit}&language=${language}` : null,
    false,
  );
  useEffect(() => {
    if (media?.id === id && anime && !blocked)
      saveResume(media, { number: unit, position: positionRef.current, language });
  }, [media?.id, id, unit, anime, blocked, language, saveResume]);
  const sources = useMemo(() => {
    if (!media || blocked) return [];
    const result = [];
    if (custom?.url && safeLink(custom.url))
      result.push({ ...custom, id: 'custom', label: 'Your source' });
    if (anime && media.malId) {
      const template = import.meta.env.VITE_ANIME_EMBED_TEMPLATE || '';
      if (template) {
        const url = template
          .replaceAll('{malId}', String(media.malId))
          .replaceAll('{episode}', String(unit))
          .replaceAll('{language}', language);
        if (safeLink(url))
          result.push({ id: 'configured', label: 'Anime player', kind: 'embed', url });
      }
      const resolved = automatic.data;
      if (resolved?.mediaId === id && resolved.episode === unit && resolved.language === language)
        result.push(...resolved.items);
      else {
        try {
          result.push(...defaultAnimeSources(id, unit, language));
        } catch {}
      }
    }
    if (!anime)
      result.push(
        ...(media.externalLinks || [])
          .filter((item) => ['streaming', 'reading'].includes(item.type) && safeLink(item.url))
          .map((item, i) => ({
            id: `external-${i}`,
            label: item.label,
            url: item.url,
            kind: 'external',
          })),
      );
    return result;
  }, [media, custom, unit, language, automatic.data, id, blocked]);
  const source = sources.find((item) => item.id === selected) || sources[0];
  const nativePlayback = ['video', 'hls'].includes(source?.kind);
  // A custom URL belongs to this title, not a verified sequence of episode URLs.
  const canAutoNext = nativePlayback && source?.id !== 'custom';
  const playbackHint = !nativePlayback
    ? 'This provider manages playback. Use the controls inside its player.'
    : !canAutoNext
      ? 'Auto next needs a separate video source for each episode.'
      : '';
  useEffect(() => {
    setWatchPage({
      path: window.location.pathname,
      mediaId: id,
      title: titleOf(media),
      unit,
      category: anime ? 'ANIME' : media?.category,
      language: anime ? language : null,
      source: source || null,
      sources,
      loadingSources: automatic.loading,
      controlSupported: ['video', 'hls'].includes(source?.kind),
    });
    return () => setWatchPage(null);
  }, [id, unit, anime, language, media, source, sources, automatic.loading]);
  const nextUnit = (number) => {
    if (availability.loading || availability.state(number) === 'unreleased') {
      notify(
        availability.loading
          ? 'Checking episode releases…'
          : `Episode ${number} has not been released yet.`,
        'error',
      );
      return;
    }
    navigate(
      `/${anime ? 'watch' : 'read'}/${id}/${Math.max(1, total ? Math.min(total, number) : number)}${anime ? `?${params}` : ''}`,
    );
  };
  const mark = async () => {
    const saved = await updateEntry(media, {
      progress: Math.max(entry?.progress || 0, unit),
      status: total && unit >= total ? 'completed' : anime ? 'watching' : 'reading',
    });
    if (saved) setPlayerSaved(true);
  };
  const onProgress = (time) => {
    positionRef.current = time;
    saveResume(media, { number: unit, position: time, language });
  };
  const onEnded = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (user)
      void updateEntry(media, {
        progress: Math.max(entry?.progress || 0, unit),
        status: total && unit >= total ? 'completed' : 'watching',
      });
    if (
      autoNext &&
      canAutoNext &&
      total &&
      unit < total &&
      !availability.loading &&
      availability.state(unit + 1) !== 'unreleased'
    )
      nextUnit(unit + 1);
  };
  const bookmark = async () => {
    setBookmarkBusy(true);
    try {
      await updateEntry(media, {
        favorite: !entry?.favorite,
        ...(!entry ? { status: 'planned' } : {}),
      });
    } finally {
      setBookmarkBusy(false);
    }
  };
  if (resource.loading) return <Loading />;
  if (resource.error || !media)
    return (
      <div className="page">
        <ErrorNotice message={resource.error || 'Title not found'} retry={resource.refresh} />
      </div>
    );
  return (
    <div className={`page watch-page watch-cinema${theater ? ' is-theater' : ''}`}>
      <Link className="back-link" to={`/title/${id}`}>
        <ArrowLeft size={16} />
        {titleOf(media)}
      </Link>
      <h1 className="watch-page-title">{titleOf(media)}</h1>
      <div className="watch-layout">
        <div className="watch-stage">
          {blocked ? (
            <div className="room-empty-stage episode-unreleased-stage" role="status">
              <span className="eyebrow">{unreleased ? 'UPCOMING EPISODE' : 'EPISODE GUIDE'}</span>
              <h2>
                {unreleased
                  ? `Episode ${unit} hasn’t been released yet`
                  : 'Checking episode releases…'}
              </h2>
              {unreleased && <p>Choose an available episode from the list.</p>}
            </div>
          ) : source ? (
            ['video', 'hls'].includes(source.kind) ? (
              <SourcePlayer
                key={`${id}:${unit}:${source.id}`}
                source={source}
                playerRef={videoRef}
                poster={bannerOf(media)}
                title={titleOf(media)}
                autoplay={autoplay}
                initialTime={resume}
                onProgress={onProgress}
                onEnded={onEnded}
              />
            ) : (
              <ExternalPlayer source={source} poster={bannerOf(media)} title={titleOf(media)} />
            )
          ) : (
            <div
              className="room-empty-stage"
              style={{ '--player-poster': `url("${bannerOf(media)}")` }}
            >
              <span className="empty-icon">
                {anime ? <MonitorPlay size={30} /> : <BookOpen size={30} />}
              </span>
              <h2>{anime ? 'Choose where to watch.' : 'Your next chapter is out there.'}</h2>
              <p>
                {anime
                  ? 'Try another episode or add a source of your own.'
                  : 'Open a publisher’s reader or add your own reading source.'}
              </p>
              <Button onClick={() => setSourceOpen(true)}>
                <Link2 size={17} />
                Add a source
              </Button>
            </div>
          )}
          <div className="watch-controls" aria-label="Watching controls" role="group">
            <div className="watch-control-group">
              <button aria-pressed={theater} onClick={() => setTheater(!theater)}>
                <Monitor size={16} />
                Theater
              </button>
              {anime && !blocked && source && (
                <ChromecastControls
                  key={`${id}:${unit}:${source.id}:${source.url}`}
                  source={source}
                  mediaId={id}
                  title={titleOf(media)}
                  episode={unit}
                  poster={bannerOf(media)}
                  videoRef={videoRef}
                  onProgress={onProgress}
                />
              )}
              <button
                aria-pressed={canAutoNext && autoNext}
                disabled={!canAutoNext || !total}
                title={
                  playbackHint ||
                  (!total
                    ? 'The episode count is not yet available.'
                    : 'Continue to the next episode when this one ends')
                }
                onClick={() => savePreference('yoru:watch-auto-next', !autoNext, setAutoNext)}
              >
                <SkipForward size={16} />
                Auto next
                <span className="watch-switch" />
              </button>
              <button
                aria-pressed={nativePlayback && autoplay}
                disabled={!nativePlayback}
                title={
                  !nativePlayback
                    ? playbackHint
                    : 'Start direct video automatically when the browser allows it'
                }
                onClick={() => savePreference('yoru:watch-autoplay', !autoplay, setAutoplay)}
              >
                <CirclePlay size={16} />
                Autoplay
                <span className="watch-switch" />
              </button>
              <button
                disabled={
                  unit <= 1 || availability.loading || availability.state(unit - 1) === 'unreleased'
                }
                onClick={() => nextUnit(unit - 1)}
              >
                <ChevronLeft size={16} />
                Previous
              </button>
              <button
                disabled={
                  Boolean(total && unit >= total) ||
                  availability.loading ||
                  availability.state(unit + 1) === 'unreleased'
                }
                onClick={() => nextUnit(unit + 1)}
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="watch-control-group">
              <button onClick={mark} disabled={blocked}>
                <Check size={16} />
                {playerSaved || entry?.progress >= unit ? 'Marked complete' : 'Mark complete'}
              </button>
              <button
                aria-pressed={Boolean(entry?.favorite)}
                disabled={bookmarkBusy}
                onClick={bookmark}
              >
                <Bookmark size={16} />
                {entry?.favorite ? 'Bookmarked' : 'Bookmark'}
              </button>
            </div>
          </div>
          <div className="watch-source-heading">
            <div>
              <strong>
                {unreleased ? 'Unreleased' : 'You are watching'} {anime ? 'Episode' : 'Chapter'}{' '}
                {unit}
              </strong>
              {!blocked && <span>Choose another source if playback is unstable.</span>}
            </div>
            {playbackHint && <p>{playbackHint}</p>}
          </div>
          <div className="player-toolbar">
            {anime && (
              <div className="watch-language-options" role="group" aria-label="Audio language">
                <button aria-pressed={language === 'sub'} onClick={() => setLanguage('sub')}>
                  <MessageSquare size={12} aria-hidden="true" />
                  Sub
                </button>
                <button aria-pressed={language === 'dub'} onClick={() => setLanguage('dub')}>
                  <Mic size={12} aria-hidden="true" />
                  Dub
                </button>
              </div>
            )}
            <div className="source-buttons">
              {sources.map((item) => (
                <button
                  key={item.id}
                  className={source?.id === item.id ? 'active' : ''}
                  aria-pressed={source?.id === item.id}
                  onClick={() => setSelected(item.id)}
                >
                  {item.label}
                  {item.kind === 'external' && <ExternalLink size={12} />}
                </button>
              ))}
              <button className="source-add" onClick={() => setSourceOpen(true)}>
                <Plus size={14} />
                Add source
              </button>
            </div>
          </div>
        </div>
        <div className="watch-sidebar">
          <aside className="watch-units" aria-label="Episode browser">
            <div className="panel-heading">
              <h3>{anime ? 'Episodes' : 'Chapters'}</h3>
              <span>{total || 'Ongoing'}</span>
              <div className="episode-view-toggle" role="group" aria-label="Episode display">
                <button
                  aria-label="Episode tiles"
                  aria-pressed={episodeView === 'tiles'}
                  onClick={() => savePreference('yoru:episode-view', 'tiles', setEpisodeView)}
                >
                  <Grid2X2 size={16} />
                </button>
                <button
                  aria-label="Episode list"
                  aria-pressed={episodeView === 'list'}
                  onClick={() => savePreference('yoru:episode-view', 'list', setEpisodeView)}
                >
                  <List size={17} />
                </button>
              </div>
            </div>
            <form
              className="unit-jump"
              onSubmit={(e) => {
                e.preventDefault();
                nextUnit(Number(unitDraft));
              }}
            >
              <input
                aria-label={`Go to ${anime ? 'episode' : 'chapter'}`}
                type="number"
                min="1"
                max={total || 100000}
                required
                value={unitDraft}
                onChange={(e) => setUnitDraft(e.target.value)}
              />
              <button className="btn btn-subtle" type="submit">
                Go
                <ArrowRight size={14} />
              </button>
            </form>
            <div className="episode-range">
              <button
                aria-label="Previous episode group"
                disabled={episodeGroup === 0}
                onClick={() => setEpisodeGroup((value) => Math.max(0, value - 1))}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {String(episodeGroup * 50 + 1).padStart(3, '0')} –{' '}
                {String(
                  Math.min((episodeGroup + 1) * 50, total || (episodeGroup + 1) * 50),
                ).padStart(3, '0')}
              </span>
              <button
                aria-label="Next episode group"
                disabled={Boolean(total && (episodeGroup + 1) * 50 >= total)}
                onClick={() => setEpisodeGroup((value) => value + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            {anime &&
              episodeView === 'list' &&
              (episodeDetails.error || episodeDetails.data?.partial) && (
                <p className="watch-episode-note" role="status">
                  Some episode details are unavailable.{' '}
                  <button onClick={episodeDetails.refresh}>Retry details</button>
                </p>
              )}
            <div key={`${id}:${episodeGroup}`} className={`watch-unit-list episode-${episodeView}`}>
              {Array.from(
                { length: Math.min(50, total || 50) },
                (_, i) => episodeGroup * 50 + i + 1,
              )
                .filter((number) => !total || number <= total)
                .map((number) => {
                  const future = anime && availability.state(number) === 'unreleased';
                  return (
                    <button
                      className={future ? 'is-unreleased' : number === unit ? 'active' : ''}
                      disabled={future || availability.loading}
                      title={future ? `Episode ${number} · Unreleased` : undefined}
                      aria-label={`${anime ? 'Episode' : 'Chapter'} ${number}${future ? ', unreleased' : number === unit ? ', now playing' : number <= entry?.progress ? ', completed' : ''}`}
                      aria-current={number === unit ? 'true' : undefined}
                      key={number}
                      onClick={() => nextUnit(number)}
                    >
                      {episodeView === 'list' && anime ? (
                        <WatchEpisodePreview
                          key={`${id}:${number}`}
                          media={media}
                          episode={episodeByNumber.get(number)}
                          number={number}
                          active={number === unit}
                          completed={number <= entry?.progress}
                          language={language}
                          loading={episodeDetails.loading}
                          unreleased={future}
                        />
                      ) : (
                        <span className="episode-number">{String(number).padStart(2, '0')}</span>
                      )}
                      {future && episodeView === 'tiles' && (
                        <small className="episode-soon">Soon</small>
                      )}
                      {episodeView === 'list' && !anime && (
                        <span className="episode-copy">
                          <strong>
                            {anime ? 'Episode' : 'Chapter'} {number}
                          </strong>
                          <small>
                            {number === unit
                              ? 'Now playing'
                              : number <= entry?.progress
                                ? 'Completed'
                                : 'Select episode'}
                          </small>
                        </span>
                      )}
                      {!future &&
                        (episodeView !== 'list' || !anime) &&
                        (number === unit ? (
                          <Play className="episode-state" size={12} fill="currentColor" />
                        ) : number <= entry?.progress ? (
                          <Check className="episode-state" size={13} />
                        ) : null)}
                    </button>
                  );
                })}
            </div>
          </aside>
          <RoomLauncher
            media={media}
            unit={unit}
            source={source}
            getPosition={() => Number(readSource(`yoru:position:${id}:${unit}`)) || 0}
          />
        </div>
      </div>
      <WatchDetails media={media} />
      <AnimeCast key={id} mediaId={id} />
      <Discussion key={`${id}-${unit}`} mediaId={id} unit={unit} />
      {sourceOpen && (
        <SourceForm
          close={() => setSourceOpen(false)}
          initial={custom || {}}
          onSave={(source) => {
            try {
              localStorage.setItem(`yoru:source:${id}`, JSON.stringify(source));
            } catch {
              throw new Error('Your browser could not save this source. Check available storage.');
            }
            setCustom(source);
            setSelected('custom');
            notify('Source saved on this device');
          }}
        />
      )}
    </div>
  );
}

export default function Watch() {
  const { user, resumeReady } = useApp();
  if (!resumeReady) return <Loading />;
  return <WatchSession key={user?.id || 'guest'} />;
}
