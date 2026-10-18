import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
} from 'lucide-react';
import { bannerOf, isAnime, safeLink, titleOf } from '../api';
import { recordView } from '../watch-views';
import { useApp, useResource } from '../state';
import { Button, Empty, ErrorNotice, Loading } from '../components';
import SourcePlayer from '../SourcePlayer';
import Discussion from '../Discussion';
import { ExternalPlayer, SourceForm } from '../Playback';
import { defaultAnimeSources } from '../../shared/anime-sources';
import { setWatchPage } from '../webmcp-state';
import '../watch.css';
import WatchDetails from '../WatchDetails';
import AnimeCast from '../AnimeCast';
const readSource = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || null;
  } catch {
    return null;
  }
};
export default function Watch() {
  const { id, unit: unitParam } = useParams();
  const navigate = useNavigate();
  const unit = Math.max(1, Number(unitParam) || 1);
  const resource = useResource(`/api/media/${id}`);
  const media = resource.data?.media || resource.data;
  const { entryFor, updateEntry, notify, user } = useApp();
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
    setResume(Number(readSource(`yoru:position:${id}:${unit}`)) || 0);
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
  const automatic = useResource(
    anime ? `/api/media/${id}/sources?episode=${unit}&language=${language}` : null,
    false,
  );
  const total = anime ? media?.episodes : media?.chapters;
  const sources = useMemo(() => {
    if (!media) return [];
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
  }, [media, custom, unit, language, automatic.data, id]);
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
  const nextUnit = (number) =>
    navigate(
      `/${anime ? 'watch' : 'read'}/${id}/${Math.max(1, total ? Math.min(total, number) : number)}${anime ? `?${params}` : ''}`,
    );
  const mark = async () => {
    const saved = await updateEntry(media, {
      progress: Math.max(entry?.progress || 0, unit),
      status: total && unit >= total ? 'completed' : anime ? 'watching' : 'reading',
    });
    if (saved) setPlayerSaved(true);
  };
  const onProgress = (time) => {
    try {
      localStorage.setItem(`yoru:position:${id}:${unit}`, JSON.stringify(time));
    } catch {
      /* playback continues when device storage is unavailable */
    }
  };
  const onEnded = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (user)
      void updateEntry(media, {
        progress: Math.max(entry?.progress || 0, unit),
        status: total && unit >= total ? 'completed' : 'watching',
      });
    if (autoNext && canAutoNext && total && unit < total) nextUnit(unit + 1);
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
      <div className="watch-heading">
        <div>
          <h1>{titleOf(media)}</h1>
          <p>
            {anime ? 'Episode' : 'Chapter'} {unit}
            {total ? ` of ${total}` : ''}
          </p>
        </div>
        <Link className="btn btn-secondary" to={`/rooms?media=${id}`}>
          <Users size={17} />
          Enjoy together
        </Link>
      </div>
      <div className="watch-layout">
        <div className="watch-stage">
          {source ? (
            ['video', 'hls'].includes(source.kind) ? (
              <SourcePlayer
                key={`${id}:${unit}:${source.id}`}
                source={source}
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
              <button disabled={unit <= 1} onClick={() => nextUnit(unit - 1)}>
                <ChevronLeft size={16} />
                Previous
              </button>
              <button disabled={Boolean(total && unit >= total)} onClick={() => nextUnit(unit + 1)}>
                Next
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="watch-control-group">
              <button onClick={mark}>
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
                You are watching {anime ? 'Episode' : 'Chapter'} {unit}
              </strong>
              <span>Choose another source if playback is unstable.</span>
            </div>
            {playbackHint && <p>{playbackHint}</p>}
          </div>
          <div className="player-toolbar">
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
              <button onClick={() => setSourceOpen(true)}>
                <Plus size={14} />
                Add source
              </button>
            </div>
            {anime && (
              <div className="segmented">
                <button
                  aria-pressed={language === 'sub'}
                  className={language === 'sub' ? 'active' : ''}
                  onClick={() => setLanguage('sub')}
                >
                  Sub
                </button>
                <button
                  className={language === 'dub' ? 'active' : ''}
                  aria-pressed={language === 'dub'}
                  onClick={() => setLanguage('dub')}
                >
                  Dub
                </button>
              </div>
            )}
          </div>
          {anime && (
            <div className="source-discovery-note" role="status">
              {automatic.loading
                ? 'Finding more providers…'
                : automatic.error ||
                  automatic.data?.warnings?.[0] ||
                  'Sources matched automatically. Try another match if this episode does not play.'}
              {(automatic.error || automatic.data?.warnings?.length > 0) && (
                <button className="text-link" onClick={automatic.refresh}>
                  Retry lookup
                </button>
              )}
            </div>
          )}
          <p className="player-note">
            {source?.kind === 'external'
              ? 'The provider opens separately. Your discussion stays here.'
              : source?.kind === 'embed'
                ? 'An external player is shown here. If it cannot load, open the provider or choose another source.'
                : 'Your video source stays with its provider. Playback position is saved on this device.'}
          </p>
        </div>
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
              {episodeGroup * 50 + 1} –{' '}
              {Math.min((episodeGroup + 1) * 50, total || (episodeGroup + 1) * 50)}
            </span>
            <button
              aria-label="Next episode group"
              disabled={Boolean(total && (episodeGroup + 1) * 50 >= total)}
              onClick={() => setEpisodeGroup((value) => value + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className={`watch-unit-list episode-${episodeView}`}>
            {Array.from({ length: Math.min(50, total || 50) }, (_, i) => episodeGroup * 50 + i + 1)
              .filter((number) => !total || number <= total)
              .map((number) => (
                <button
                  className={number === unit ? 'active' : ''}
                  aria-label={`${anime ? 'Episode' : 'Chapter'} ${number}${number === unit ? ', now playing' : number <= entry?.progress ? ', completed' : ''}`}
                  aria-current={number === unit ? 'true' : undefined}
                  key={number}
                  onClick={() => nextUnit(number)}
                >
                  <span className="episode-number">{String(number).padStart(2, '0')}</span>
                  {episodeView === 'list' && (
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
                  {number === unit ? (
                    <Play className="episode-state" size={12} fill="currentColor" />
                  ) : number <= entry?.progress ? (
                    <Check className="episode-state" size={13} />
                  ) : null}
                </button>
              ))}
          </div>
        </aside>
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
