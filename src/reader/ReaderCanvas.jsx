import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImageOff, LoaderCircle, RotateCw } from 'lucide-react';

function PageImage({ page, number, chapter, eager, onTap }) {
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  return (
    <div
      className={`comic-page ${status}`}
      data-page={number}
      style={
        page.width && page.height ? { aspectRatio: `${page.width} / ${page.height}` } : undefined
      }
    >
      {status !== 'error' && (
        <img
          key={attempt}
          src={page.url}
          alt={`Chapter ${chapter.number}, page ${number}`}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
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
          <p>The image may be unavailable at its source.</p>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setStatus('loading');
              setAttempt((n) => n + 1);
            }}
          >
            <RotateCw size={14} />
            Retry page {number}
          </button>
        </div>
      )}
    </div>
  );
}
export default function ReaderCanvas({
  chapter,
  page,
  preferences,
  jump,
  onVisiblePage,
  onTurn,
  onToggleControls,
  onScrollDirection,
}) {
  const container = useRef();
  const scrollPosition = useRef(0);
  const position = useRef(page);
  const alignedSize = useRef('');
  position.current = page;
  const paged = ['single', 'double'].includes(preferences.mode);
  const [pages, setPages] = useState([]);
  useEffect(() => {
    const element = container.current;
    scrollPosition.current = element.scrollTop;
    const scroll = () => {
      const current = element.scrollTop;
      if (Math.abs(current - scrollPosition.current) > 5)
        onScrollDirection(current < scrollPosition.current ? 'up' : 'down');
      scrollPosition.current = current;
    };
    // Fit-both pages may have no overflow; an upward wheel gesture still reveals controls.
    const wheel = (event) => {
      if (Math.abs(event.deltaY) > 3) onScrollDirection(event.deltaY < 0 ? 'up' : 'down');
    };
    element.addEventListener('scroll', scroll, { passive: true });
    element.addEventListener('wheel', wheel, { passive: true });
    return () => {
      element.removeEventListener('scroll', scroll);
      element.removeEventListener('wheel', wheel);
    };
  }, [onScrollDirection]);
  // Allocate and release URLs in the same effect: StrictMode can replay its setup.
  useEffect(() => {
    const loaded = chapter.pages.map((item) => ({
      ...item,
      url: item.blob ? URL.createObjectURL(item.blob) : item.url,
    }));
    setPages(loaded);
    return () =>
      loaded.forEach((item) => {
        if (item.blob) URL.revokeObjectURL(item.url);
      });
  }, [chapter]);
  useLayoutEffect(() => {
    if (paged) {
      container.current.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      scrollPosition.current = container.current.scrollTop;
      return;
    }
    const target = container.current.querySelector(`[data-page="${page}"]`);
    if (target)
      container.current.scrollTo({
        top:
          container.current.scrollTop +
          target.getBoundingClientRect().top -
          container.current.getBoundingClientRect().top,
        behavior: 'instant',
      });
    // Restoring a page or resizing is not a reader scroll gesture.
    scrollPosition.current = container.current.scrollTop;
  }, [chapter.id, jump, preferences.mode, pages]);
  useLayoutEffect(() => {
    if (paged) return;
    const element = container.current;
    const strip = element.querySelector('.reader-pages');
    const measure = () => `${element.clientWidth}:${element.clientHeight}:${strip.clientWidth}`;
    let size = measure();
    alignedSize.current = size;
    const observer = new ResizeObserver(() => {
      const next = measure();
      if (next === size) return;
      size = next;
      alignedSize.current = next;
      const target = element.querySelector(`[data-page="${position.current}"]`);
      if (target)
        element.scrollTo({
          top:
            element.scrollTop +
            target.getBoundingClientRect().top -
            element.getBoundingClientRect().top,
          behavior: 'instant',
        });
      scrollPosition.current = element.scrollTop;
    });
    observer.observe(element);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [paged]);
  useEffect(() => {
    if (!paged) return;
    const ahead = pages
      .slice(page, page + 2)
      .filter((item) => !item.blob)
      .map((item) => {
        const image = new Image();
        image.referrerPolicy = 'no-referrer';
        image.src = item.url;
        return image;
      });
    return () => ahead.forEach((image) => (image.src = ''));
  }, [pages, page, paged]);
  useEffect(() => {
    if (paged) return;
    const element = container.current;
    let frame;
    const observe = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // A viewport reflow can dispatch scroll before ResizeObserver restores the page.
        // Do not save that intermediate position as a deliberate reading-page change.
        const strip = element.querySelector('.reader-pages');
        if (
          `${element.clientWidth}:${element.clientHeight}:${strip.clientWidth}` !==
          alignedSize.current
        )
          return;
        const marker =
          element.getBoundingClientRect().top + Math.min(180, element.clientHeight * 0.3);
        const nodes = [...element.querySelectorAll('[data-page]')];
        const current = nodes.find((node) => {
          const r = node.getBoundingClientRect();
          return r.top <= marker && r.bottom > marker;
        });
        if (current) onVisiblePage(Number(current.dataset.page));
      });
    };
    element.addEventListener('scroll', observe, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('scroll', observe);
    };
  }, [paged, onVisiblePage]);
  const tap = (event) => {
    if (!paged) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const portion = (event.clientX - bounds.left) / bounds.width;
    if (portion > 0.33 && portion < 0.67) onToggleControls();
    else onTurn((portion < 0.33 ? -1 : 1) * (preferences.direction === 'rtl' ? -1 : 1));
  };
  const visible = paged
    ? pages
        .map((item, index) => ({ item, index }))
        .slice(page - 1, page - 1 + (preferences.mode === 'double' ? 2 : 1))
    : pages.map((item, index) => ({ item, index }));
  return (
    <div
      ref={container}
      className="reader-canvas"
      data-mode={preferences.mode}
      data-fit={preferences.fit}
      aria-label="Comic pages"
      tabIndex={0}
      style={{ '--reader-width': `${preferences.width}px`, '--page-gap': `${preferences.gap}px` }}
    >
      <div
        className={`reader-pages ${paged && preferences.direction === 'rtl' ? 'right-to-left' : ''}`}
      >
        {visible.map(({ item, index }) => (
          <PageImage
            key={`${index}:${item.url}`}
            page={item}
            number={index + 1}
            chapter={chapter}
            eager={paged || Math.abs(index - (page - 1)) <= 1}
            onTap={tap}
          />
        ))}
      </div>
      {!paged && (
        <div className="reader-end">
          <strong>You’ve reached the end of this chapter.</strong>
          <span>Open the reader menu or scroll up to choose another chapter.</span>
        </div>
      )}
    </div>
  );
}
