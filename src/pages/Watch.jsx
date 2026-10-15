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
  const { entryFor, updateEntry, notify } = useApp();
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
  useEffect(() => {
    setCustom(readSource(`yoru:source:${id}`));
  }, [id]);
  useEffect(() => {
    setUnitDraft(unit);
    setResume(Number(readSource(`yoru:position:${id}:${unit}`)) || 0);
    setPlayerSaved(false);
  }, [id, unit]);
  const anime = isAnime(media);
  useEffect(() => {
    if (!anime || media?.id !== id || resource.loading || resource.error) return;
    let recorded = false;
    const record = () => {
      if (recorded || document.hidden) return;
      recorded = true;
      recordView(id).catch(() => {});
    };
    record();
    document.addEventListener('visibilitychange', record);
    return () => document.removeEventListener('visibilitychange', record);
  }, [id, anime, media?.id, resource.loading, resource.error]);
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
  if (resource.loading) return <Loading />;
  if (resource.error || !media)
    return (
      <div className="page">
        <ErrorNotice message={resource.error || 'Title not found'} retry={resource.refresh} />
      </div>
    );
  return (
    <div className="page watch-page">
      <Link className="back-link" to={`/title/${id}`}>
        <ArrowLeft size={16} />
        {titleOf(media)}
      </Link>
      <div className="watch-heading">
        <div>
          <span className="eyebrow">
            {anime ? 'SETTLE IN. THE WORLD CAN WAIT.' : 'ONE MORE CHAPTER NEVER HURT.'}
          </span>
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
                autoplay={false}
                initialTime={resume}
                onProgress={onProgress}
                onEnded={mark}
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
                  className={language === 'sub' ? 'active' : ''}
                  onClick={() => setLanguage('sub')}
                >
                  Sub
                </button>
                <button
                  className={language === 'dub' ? 'active' : ''}
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
          <div className="watch-progress-row">
            <button
              className="btn btn-subtle"
              disabled={unit <= 1}
              onClick={() => nextUnit(unit - 1)}
            >
              <ArrowLeft size={15} />
              Previous
            </button>
            <Button variant="secondary" onClick={mark}>
              <Check size={16} />
              {playerSaved || entry?.progress >= unit ? 'Marked complete' : 'Mark complete'}
            </Button>
            <button
              className="btn btn-subtle"
              disabled={Boolean(total && unit >= total)}
              onClick={() => nextUnit(unit + 1)}
            >
              Next
              <ArrowRight size={15} />
            </button>
          </div>
          <p className="player-note">
            {source?.kind === 'external'
              ? 'The provider opens separately. Your discussion stays here.'
              : source?.kind === 'embed'
                ? 'An external player is shown here. If it cannot load, open the provider or choose another source.'
                : 'Your video source stays with its provider. Playback position is saved on this device.'}
          </p>
        </div>
        <aside className="watch-units">
          <div className="panel-heading">
            <h3>{anime ? 'Episodes' : 'Chapters'}</h3>
            <span>{total || 'Ongoing'}</span>
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
          <div className="watch-unit-list">
            {Array.from(
              { length: Math.min(50, total || 50) },
              (_, i) => Math.max(0, Math.floor((unit - 1) / 50) * 50) + i + 1,
            )
              .filter((number) => !total || number <= total)
              .map((number) => (
                <button
                  className={number === unit ? 'active' : ''}
                  key={number}
                  onClick={() => nextUnit(number)}
                >
                  <span>
                    {number === unit ? (
                      <Play size={12} />
                    ) : number <= entry?.progress ? (
                      <Check size={13} />
                    ) : (
                      String(number).padStart(2, '0')
                    )}
                  </span>
                  {anime ? 'Episode' : 'Chapter'} {number}
                </button>
              ))}
          </div>
        </aside>
      </div>
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
