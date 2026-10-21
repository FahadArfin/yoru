import React, { useEffect, useRef, useState } from 'react';
import { ImageOff, LoaderCircle, RotateCw } from 'lucide-react';
import { loadReaderPage } from './page-loading';

export default function RemotePageImage({ url, page, number, chapter, eager, onTap, context }) {
  const element = useRef();
  const [near, setNear] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState(null);
  const [status, setStatus] = useState('loading');
  const activated = near || eager;
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { root: element.current.closest('.reader-canvas'), rootMargin: '1200px 0px' },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!activated || !url) return;
    const controller = new AbortController();
    const signal = context?.signal
      ? AbortSignal.any([controller.signal, context.signal])
      : controller.signal;
    let objectUrl;
    setImage(null);
    setStatus('loading');
    loadReaderPage(url, signal)
      .then((blob) => {
        if (signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setImage(objectUrl);
      })
      .catch(() => {
        if (!signal.aborted) setStatus('error');
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, activated, attempt, context?.signal]);
  return (
    <div
      ref={element}
      className={`comic-page ${status}`}
      data-page={number}
      data-edition={chapter.id}
      style={
        status !== 'ready'
          ? { aspectRatio: `${page.width || 700} / ${page.height || 1000}` }
          : undefined
      }
    >
      {image && status !== 'error' && (
        <img
          src={image}
          alt={`Chapter ${chapter.number}, page ${number}`}
          decoding="async"
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
          onClick={onTap}
        />
      )}
      {status === 'loading' && (
        <span className="page-loading" aria-hidden="true">
          <LoaderCircle className="spin" size={22} />
        </span>
      )}
      {status === 'error' && (
        <div className="page-failure" role="status">
          <ImageOff size={28} />
          <strong>Page {number} couldn’t load.</strong>
          <p>The source is still unavailable. You can try this page again.</p>
          <button
            className="btn btn-secondary"
            disabled={!url}
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RotateCw size={14} />
            Retry page {number}
          </button>
        </div>
      )}
    </div>
  );
}
