import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Link2, Play, Plus, X } from 'lucide-react';
import { Button, Empty, ErrorNotice, Modal } from './components';
import { safeLink } from './api';
export function SourceForm({ close, onSave, initial = {} }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const value = Object.fromEntries(new FormData(e.currentTarget));
    if (!safeLink(value.url)) {
      setError('Enter a complete HTTP or HTTPS link.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave(value);
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Choose an external source" close={close}>
      <span className="eyebrow">BRING YOUR OWN SOURCE</span>
      <h2>Choose your source.</h2>
      <p className="muted">
        Paste a watching or reading link, or a video URL you have permission to use. Your media
        stays with its provider.
      </p>
      <form className="form-stack" onSubmit={submit}>
        <label>
          Source URL
          <input
            name="url"
            type="url"
            required
            placeholder="https://…"
            defaultValue={initial.url || ''}
          />
        </label>
        <label>
          Source type
          <select aria-label="Source type" name="kind" defaultValue={initial.kind || 'external'}>
            <option value="external">Open provider in a new tab</option>
            <option value="embed">Embedded player or reader</option>
            <option value="video">Direct video (MP4 / WebM)</option>
            <option value="hls">HLS stream (.m3u8)</option>
          </select>
        </label>
        <p className="small muted">
          Direct video and HLS support room playback synchronization. Other providers open
          independently unless they expose a supported player API.
        </p>
        {error && <ErrorNotice message={error} />}
        <Button busy={busy} type="submit">
          Use this source
          <Link2 size={16} />
        </Button>
      </form>
    </Modal>
  );
}
export function ExternalPlayer({ source, poster, title }) {
  if (source?.kind === 'embed')
    return (
      <div className="embed-player">
        <iframe
          src={safeLink(source.url)}
          title={`${title} external player`}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
          allowFullScreen
        />
        <a className="embed-fallback" href={safeLink(source.url)} target="_blank" rel="noreferrer">
          Player blocked? Open provider <ExternalLink size={13} />
        </a>
      </div>
    );
  return (
    <div
      className="external-player"
      style={poster ? { '--player-poster': `url("${poster}")` } : {}}
    >
      <div />
      <span className="external-play-icon">
        <Play size={30} />
      </span>
      <h3>Your story is a click away.</h3>
      <p>Continue on the provider, then come back for the conversation.</p>
      <a className="btn btn-primary" href={safeLink(source.url)} target="_blank" rel="noreferrer">
        Open provider
        <ExternalLink size={16} />
      </a>
    </div>
  );
}
export function SyncedVideo({ room, isHost, onState, poster }) {
  const videoRef = useRef();
  const stateRef = useRef(room);
  stateRef.current = room;
  const hostRef = useRef(isHost);
  hostRef.current = isHost;
  const updateRef = useRef(onState);
  updateRef.current = onState;
  const sourceLoading = useRef(true);
  const applyRef = useRef();
  const [error, setError] = useState('');
  const [needsPlay, setNeedsPlay] = useState(false);
  applyRef.current = (force = false) => {
    const video = videoRef.current;
    const current = stateRef.current;
    if (!video || video.readyState < 1 || sourceLoading.current) return;
    const elapsed = current.paused
      ? 0
      : Math.max(0, (Date.now() - new Date(current.stateUpdatedAt).getTime()) / 1000);
    const desired = current.position + elapsed;
    const target = Number.isFinite(video.duration) ? Math.min(video.duration, desired) : desired;
    if (Number.isFinite(target) && Math.abs(video.currentTime - target) > (force ? 0.2 : 0.75)) {
      try {
        video.currentTime = Math.max(0, target);
      } catch {}
    }
    if (current.paused) {
      video.pause();
      setNeedsPlay(false);
    } else if (video.paused) {
      video
        .play()
        .then(() => setNeedsPlay(false))
        .catch(() => setNeedsPlay(true));
    }
  };
  useEffect(() => {
    const video = videoRef.current;
    let hls;
    let cancelled = false;
    sourceLoading.current = true;
    setError('');
    setNeedsPlay(false);
    const ready = () => {
      if (cancelled) return;
      sourceLoading.current = false;
      applyRef.current(true);
    };
    const fail = () => {
      if (!cancelled) setError('The provider could not load this video. Try another source.');
    };
    video.addEventListener('loadedmetadata', ready);
    video.addEventListener('error', fail);
    (async () => {
      try {
        if (room.sourceKind === 'hls' && !video.canPlayType('application/vnd.apple.mpegurl')) {
          const { default: Hls } = await import('hls.js/light');
          if (cancelled) return;
          if (!Hls.isSupported()) throw new Error('This browser cannot play this stream.');
          hls = new Hls({ enableWorker: true, backBufferLength: 60 });
          hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) fail();
          });
          hls.loadSource(room.sourceUrl);
          hls.attachMedia(video);
        } else {
          video.src = room.sourceUrl;
          video.load();
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
      sourceLoading.current = true;
      hls?.destroy();
      video.removeEventListener('loadedmetadata', ready);
      video.removeEventListener('error', fail);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [room.sourceUrl, room.sourceKind]);
  useEffect(() => {
    applyRef.current(true);
  }, [room.version, room.sourceUrl]);
  useEffect(() => {
    if (isHost) return;
    const timer = setInterval(() => applyRef.current(false), 1000);
    const resume = () => {
      if (!document.hidden) applyRef.current(true);
    };
    document.addEventListener('visibilitychange', resume);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [isHost]);
  const hostChange = (event) => {
    const video = videoRef.current;
    if (!hostRef.current || sourceLoading.current || video.readyState < 1) return;
    const current = stateRef.current;
    const expected =
      current.position +
      (current.paused
        ? 0
        : Math.max(0, (Date.now() - new Date(current.stateUpdatedAt).getTime()) / 1000));
    // Server-applied play/pause/seek events already match this snapshot; avoid feedback loops.
    if (
      video.paused === current.paused &&
      !(event.type === 'seeked' && Math.abs(video.currentTime - expected) > 0.35) &&
      event.type !== 'ended'
    )
      return;
    updateRef.current({ paused: video.paused, position: video.currentTime });
  };
  return (
    <div className="synced-video">
      <video
        ref={videoRef}
        poster={poster}
        controls={isHost}
        playsInline
        onPlay={hostChange}
        onPause={hostChange}
        onSeeked={hostChange}
        onEnded={hostChange}
      />
      {!isHost && <span className="sync-tag">Following the host</span>}
      {needsPlay && (
        <button
          className="btn btn-primary playback-join"
          onClick={() =>
            videoRef.current
              .play()
              .then(() => setNeedsPlay(false))
              .catch(() => setError('Press play again after the video has loaded.'))
          }
        >
          <Play size={17} />
          Join playback
        </button>
      )}
      {error && <ErrorNotice message={error} />}
    </div>
  );
}
