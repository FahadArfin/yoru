import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';

function isHlsSource(source) {
  return source?.kind === 'hls' || /\.m3u8(?:$|[?#])/i.test(source?.url || '');
}

export default function SourcePlayer({
  source,
  poster,
  title,
  autoplay,
  initialTime = 0,
  volume = 1,
  onProgress,
  onEnded,
}) {
  const videoRef = useRef(null);
  const lastProgressRef = useRef(0);
  const onProgressRef = useRef(onProgress);
  const onEndedRef = useRef(onEnded);
  const autoplayRef = useRef(autoplay);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  const iframeSource = source?.kind === 'embed' || source?.kind === 'reader';
  const externalSource = source?.kind === 'external';
  onProgressRef.current = onProgress;
  onEndedRef.current = onEnded;
  autoplayRef.current = autoplay;

  useEffect(() => {
    if (autoplay) videoRef.current?.play().catch(() => {});
  }, [autoplay]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const normalizedVolume = Math.min(1, Math.max(0, Number(volume) || 0));
    video.volume = normalizedVolume;
    video.muted = normalizedVolume === 0;
  }, [volume, source?.id, source?.url]);

  useEffect(() => {
    if (!source?.url || iframeSource || externalSource) {
      setStatus('ready');
      setError('');
      return undefined;
    }

    const video = videoRef.current;
    if (!video) return undefined;

    let hls;
    let cancelled = false;
    let initialTimeApplied = false;
    setStatus('loading');
    setError('');

    const applyInitialTime = () => {
      if (initialTimeApplied || !Number.isFinite(initialTime) || initialTime <= 0) return;
      initialTimeApplied = true;
      const safeTime = video.duration
        ? Math.min(initialTime, Math.max(0, video.duration - 2))
        : initialTime;
      video.currentTime = safeTime;
    };

    const handleCanPlay = () => {
      setStatus('ready');
      applyInitialTime();
    };
    const handleError = () => {
      if (!cancelled) {
        setStatus('error');
        setError('This source could not be played. Check the URL or switch servers.');
      }
    };
    const handleTimeUpdate = () => {
      if (!onProgressRef.current || !video.duration) return;
      const now = Date.now();
      if (now - lastProgressRef.current < 10000 && video.currentTime < video.duration - 2) return;
      lastProgressRef.current = now;
      onProgressRef.current(video.currentTime, video.duration);
    };
    const handleEnded = () => {
      if (onProgressRef.current && video.duration)
        onProgressRef.current(video.duration, video.duration);
      onEndedRef.current?.();
    };

    video.addEventListener('loadedmetadata', applyInitialTime);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    const loadSource = async () => {
      if (isHlsSource(source)) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = source.url;
        } else {
          const { default: Hls } = await import('hls.js/light');
          if (cancelled) return;
          if (!Hls.isSupported()) throw new Error('HLS playback is not supported in this browser.');
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90,
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) handleError();
          });
          hls.loadSource(source.url);
          hls.attachMedia(video);
        }
      } else {
        video.src = source.url;
      }

      if (autoplayRef.current) {
        video.play().catch(() => {});
      }
    };

    loadSource().catch((loadError) => {
      if (!cancelled) {
        setStatus('error');
        setError(loadError.message || 'The player could not load this source.');
      }
    });

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', applyInitialTime);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [source?.id, source?.url, source?.kind, initialTime, iframeSource, externalSource, retryKey]);

  if (!source?.url) return null;

  if (externalSource) {
    return (
      <div
        className="source-external"
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,.5), rgba(0,0,0,.8)), url(${poster || ''})`,
        }}
      >
        <ExternalLink size={32} />
        <strong>{source.label || 'Open source'}</strong>
        <a href={source.url} target="_blank" rel="noreferrer">
          Open in a new tab
        </a>
      </div>
    );
  }

  if (iframeSource) {
    return (
      <iframe
        key={`${source.id || source.url}-${retryKey}`}
        title={title}
        src={source.url}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-popups"
      />
    );
  }

  return (
    <div className="native-player">
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        poster={poster}
        autoPlay={autoplay}
        aria-label={title}
      />
      {status === 'loading' ? (
        <div className="player-state" role="status">
          <LoaderCircle className="spin" size={28} />
          <span>Loading source</span>
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="player-state error-state" role="alert">
          <TriangleAlert size={28} />
          <span>{error}</span>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
            <RefreshCw size={16} />
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
