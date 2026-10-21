import React, { useEffect, useRef, useState } from 'react';
import { Cast, Pause, Play, Square, X } from 'lucide-react';
import { castErrorMessage, castMediaDescriptor, getCastContext, loadCastSdk } from './chromecast';
import './chromecast.css';

export default function ChromecastControls({
  source,
  mediaId,
  title,
  episode,
  poster,
  videoRef,
  onProgress,
}) {
  const descriptor = castMediaDescriptor(source);
  const identity = JSON.stringify([mediaId, episode, descriptor?.url]);
  const [sdkState, setSdkState] = useState('loading');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remote, setRemote] = useState(null);
  const [retry, setRetry] = useState(0);
  const runtime = useRef(null);
  const currentIdentity = useRef(identity);
  const progress = useRef(onProgress);
  currentIdentity.current = identity;
  progress.current = onProgress;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    setRemote(null);
    setError('');
    setBusy(false);
    if (!descriptor) return;
    setSdkState('loading');
    loadCastSdk()
      .then((framework) => {
        if (disposed) return;
        const context = getCastContext(framework);
        const player = new framework.RemotePlayer();
        const controller = new framework.RemotePlayerController(player);
        const video = videoRef.current;
        let wasActive = false;
        let lastTime = 0;
        let lastSaved = 0;
        let lastPaused;
        const matches = () =>
          context.getCurrentSession()?.getMediaSession()?.media?.customData?.yoruCastId ===
          identity;
        const preventDuplicatePlayback = () => {
          if (matches()) video?.pause();
        };
        const update = () => {
          if (disposed) return;
          const session = context.getCurrentSession();
          const active = Boolean(session && matches() && player.isMediaLoaded);
          if (active) {
            if (!wasActive) video?.pause();
            lastTime = Number.isFinite(player.currentTime) ? player.currentTime : lastTime;
            const now = Date.now();
            if (now - lastSaved >= 10000 || lastPaused !== player.isPaused) {
              progress.current?.(lastTime);
              lastSaved = now;
            }
            lastPaused = player.isPaused;
            setRemote({
              device: session.getCastDevice()?.friendlyName || 'TV',
              paused: player.isPaused,
              canPause: player.canPause,
              canSeek: player.canSeek,
            });
          } else {
            setRemote(null);
            if (wasActive) {
              progress.current?.(lastTime);
              if (video && Number.isFinite(video.duration))
                video.currentTime = Math.min(lastTime, video.duration);
            }
          }
          wasActive = active;
        };
        runtime.current = { context, player, controller, update };
        controller.addEventListener(framework.RemotePlayerEventType.ANY_CHANGE, update);
        context.addEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, update);
        video?.addEventListener('play', preventDuplicatePlayback);
        cleanup = () => {
          controller.removeEventListener(framework.RemotePlayerEventType.ANY_CHANGE, update);
          context.removeEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, update);
          video?.removeEventListener('play', preventDuplicatePlayback);
          if (wasActive) progress.current?.(lastTime);
          runtime.current = null;
        };
        setSdkState('ready');
        update();
      })
      .catch(() => {
        if (!disposed) setSdkState('unavailable');
      });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [identity, retry, videoRef]);

  useEffect(() => {
    currentIdentity.current = identity;
    return () => {
      currentIdentity.current = null;
    };
  }, [identity]);

  const start = async () => {
    setOpen(true);
    setError('');
    if (!descriptor || sdkState !== 'ready' || !runtime.current) return;
    const { context } = runtime.current;
    const video = videoRef.current;
    setBusy(true);
    try {
      // Invoke the device picker inside the click's user activation, after SDK initialization.
      if (!context.getCurrentSession()) await context.requestSession();
      if (currentIdentity.current !== identity) return;
      const session = context.getCurrentSession();
      if (!session) throw { code: 'receiver_unavailable' };
      const api = window.chrome.cast.media;
      const info = new api.MediaInfo(descriptor.url, descriptor.contentType);
      info.streamType = api.StreamType.BUFFERED;
      info.metadata = new api.GenericMediaMetadata();
      info.metadata.title = `${title} · Episode ${episode}`;
      if (poster?.startsWith('https://'))
        info.metadata.images = [new window.chrome.cast.Image(poster)];
      info.customData = { yoruCastId: identity };
      const request = new api.LoadRequest(info);
      request.currentTime = Number.isFinite(video?.currentTime) ? video.currentTime : 0;
      request.autoplay = true;
      await session.loadMedia(request);
      if (currentIdentity.current !== identity) return;
      video?.pause();
      runtime.current?.update();
    } catch (cause) {
      if (currentIdentity.current === identity) setError(castErrorMessage(cause));
    } finally {
      if (currentIdentity.current === identity) setBusy(false);
    }
  };
  const control = (action) => {
    try {
      action(runtime.current);
    } catch (cause) {
      setError(castErrorMessage(cause));
    }
  };
  const seek = (offset) =>
    control(({ player, controller }) => {
      player.currentTime = Math.max(
        0,
        Math.min(player.duration || Infinity, player.currentTime + offset),
      );
      controller.seek();
    });
  const explanation = !descriptor
    ? ['embed', 'external'].includes(source?.kind)
      ? 'This provider uses an embedded player. Use its own Cast button if available, or select a direct video source. Yoru cannot cast the embedded page as a video.'
      : 'Casting needs a direct HTTPS video or HLS source that your TV can access.'
    : sdkState === 'unavailable'
      ? 'Google Cast is unavailable here. Use Chrome on Android or desktop with your TV on the same Wi-Fi. Chrome on iPhone and iPad does not support web casting.'
      : 'Your TV streams directly from the source. Quality depends on the source and TV. The video must allow playback on the TV without browser-only cookies or headers.';

  return (
    <div className="watch-cast">
      <button
        type="button"
        className="watch-cast-trigger"
        aria-expanded={open}
        aria-controls="watch-cast-panel"
        disabled={busy || (Boolean(descriptor) && sdkState === 'loading')}
        onClick={() => (remote ? setOpen(!open) : start())}
      >
        <Cast size={16} />
        {remote ? `Casting to ${remote.device}` : busy ? 'Connecting…' : 'Cast'}
      </button>
      {open && (
        <section id="watch-cast-panel" className="watch-cast-panel" aria-label="Cast to TV">
          <button
            type="button"
            className="watch-cast-close"
            aria-label="Close Cast controls"
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </button>
          {remote ? (
            <>
              <strong>Casting to {remote.device}</strong>
              <p>For another episode, choose it in Yoru and press Cast again.</p>
              <div className="watch-cast-actions">
                <button type="button" disabled={!remote.canSeek} onClick={() => seek(-30)}>
                  −30 sec
                </button>
                <button
                  type="button"
                  disabled={!remote.canPause}
                  onClick={() => control(({ controller }) => controller.playOrPause())}
                >
                  {remote.paused ? <Play size={16} /> : <Pause size={16} />}
                  {remote.paused ? 'Resume on TV' : 'Pause on TV'}
                </button>
                <button type="button" disabled={!remote.canSeek} onClick={() => seek(30)}>
                  +30 sec
                </button>
                <button
                  type="button"
                  onClick={() => control(({ context }) => context.endCurrentSession(true))}
                >
                  <Square size={16} />
                  Stop casting
                </button>
              </div>
            </>
          ) : (
            <>
              <strong>Cast to TV</strong>
              <p>{explanation}</p>
              {descriptor && sdkState === 'unavailable' && (
                <button type="button" onClick={() => setRetry((value) => value + 1)}>
                  Retry Cast setup
                </button>
              )}
              {descriptor && sdkState === 'ready' && (
                <button type="button" disabled={busy} onClick={start}>
                  {busy ? 'Connecting…' : 'Choose TV'}
                </button>
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
