import React, { useEffect, useRef, useState } from 'react';
import { coverCandidates } from './image-loading';

const recovered = new Map();
const placeholder = '/cover-placeholder.svg';
function Cover({
  candidates,
  alt = '',
  loading = 'lazy',
  fetchPriority = 'auto',
  className = '',
  ...props
}) {
  const primary = candidates[0];
  const [choices] = useState(() => [
    ...new Set([recovered.get(primary), ...candidates].filter(Boolean)),
    ...(primary ? [primary] : []),
  ]);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [near, setNear] = useState(loading === 'eager');
  const ref = useRef();
  const src = choices[attempt] || placeholder;
  const retry = () => {
    setReady(false);
    setAttempt((n) => (n === attempt ? n + 1 : n));
  };
  useEffect(() => {
    if (near) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near, attempt]);
  useEffect(() => {
    if (!near || ready || src === placeholder) return;
    const timer = setTimeout(retry, 8000);
    return () => clearTimeout(timer);
  }, [near, ready, src, attempt]);
  useEffect(() => {
    const online = () => {
      if (src === placeholder && primary) {
        setReady(false);
        setAttempt(0);
      }
    };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [src, primary]);
  return (
    <img
      {...props}
      key={attempt}
      ref={ref}
      className={`${className} cover-image`}
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      referrerPolicy="no-referrer"
      fetchPriority={fetchPriority}
      data-cover-state={src === placeholder ? 'unavailable' : ready ? 'ready' : 'loading'}
      onLoad={() => {
        setReady(true);
        if (primary && src !== placeholder) {
          recovered.delete(primary);
          recovered.set(primary, src);
          while (recovered.size > 160) recovered.delete(recovered.keys().next().value);
        }
      }}
      onError={() => {
        if (src !== placeholder) retry();
      }}
    />
  );
}
export default function CoverImage({ media, ...props }) {
  const candidates = coverCandidates(media);
  return <Cover key={candidates.join('|')} candidates={candidates} {...props} />;
}
