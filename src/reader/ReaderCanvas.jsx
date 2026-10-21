import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImageOff, LoaderCircle, RotateCw } from 'lucide-react';
import { warmImage } from '../image-loading';
import { readerContextKey, readerContextPath } from './requests';
import RemotePageImage from './RemotePageImage';

function PageImage({ page, number, chapter, eager, onTap, context }) {
  if (chapter.kind === 'remote') {
    let url = null;
    try {
      url = readerContextPath(page.url, context);
    } catch {
      /* Pending selection. */
    }
    return (
      <RemotePageImage
        key={url}
        url={url}
        page={page}
        number={number}
        chapter={chapter}
        eager={eager}
        onTap={onTap}
        context={context}
      />
    );
  }
  return (
    <LocalPageImage
      page={page}
      number={number}
      chapter={chapter}
      eager={eager}
      onTap={onTap}
      context={context}
    />
  );
}
function LocalPageImage({ page, number, chapter, eager, onTap, context }) {
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const [preparedUrl, setPreparedUrl] = useState(null);
  let requestUrl = page.url;
  if (chapter.kind === 'remote') {
    try {
      requestUrl = readerContextPath(page.url, context);
    } catch {
      requestUrl = null;
    }
  }
  const url = preparedUrl || requestUrl;
  return (
    <div
      className={`comic-page ${status}`}
      data-page={number}
      style={
        page.width && page.height ? { aspectRatio: `${page.width} / ${page.height}` } : undefined
      }
    >
      {status !== 'error' && url && (
        <img
          key={attempt}
          src={url}
          alt={`Chapter ${chapter.number}, page ${number}`}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(event) => {
            setPreparedUrl(event.currentTarget.src);
            setStatus('ready');
          }}
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
            disabled={!requestUrl}
            onClick={() => {
              setPreparedUrl(null);
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
  context,
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
  const scrollAnchor = useRef({ page, fraction: 0 });
  const alignedSize = useRef('');
  const paged = ['single', 'double'].includes(preferences.mode);
  const [pages, setPages] = useState([]);
  useEffect(() => {
    const element = container.current;
    scrollPosition.current = element.scrollTop;
    const scroll = () => {
      const current = element.scrollTop;
      if (!paged) {
        const strip = element.querySelector('.reader-pages');
        if (
          `${element.clientWidth}:${element.clientHeight}:${strip.clientWidth}` !==
          alignedSize.current
        )
          return;
        const top = element.getBoundingClientRect().top;
        const anchor = [...element.querySelectorAll('[data-page]')].find(
          (node) => node.getBoundingClientRect().bottom > top,
        );
        if (anchor) {
          const bounds = anchor.getBoundingClientRect();
          scrollAnchor.current = {
            page: Number(anchor.dataset.page),
            fraction: Math.max(0, (top - bounds.top) / bounds.height),
          };
        }
      }
      if (Math.abs(current - scrollPosition.current) > 5)
        onScrollDirection(current < scrollPosition.current ? 'up' : 'down');
      scrollPosition.current = current;
    };
    // With scrolling pages, capture the reading position before hiding changes their width.
    // A wheel gesture at a boundary (or on fit-both pages) still toggles the controls.
    const wheel = (event) => {
      const atBoundary =
        event.deltaY < 0
          ? element.scrollTop <= 0
          : element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
      if ((paged || atBoundary) && Math.abs(event.deltaY) > 3)
        onScrollDirection(event.deltaY < 0 ? 'up' : 'down');
    };
    element.addEventListener('scroll', scroll, { passive: true });
    element.addEventListener('wheel', wheel, { passive: true });
    return () => {
      element.removeEventListener('scroll', scroll);
      element.removeEventListener('wheel', wheel);
    };
  }, [onScrollDirection, paged]);
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
    scrollAnchor.current = { page, fraction: 0 };
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
      const anchor = scrollAnchor.current;
      const target = element.querySelector(`[data-page="${anchor.page}"]`);
      if (target)
        element.scrollTo({
          top:
            element.scrollTop +
            target.getBoundingClientRect().top -
            element.getBoundingClientRect().top +
            target.getBoundingClientRect().height * anchor.fraction,
          behavior: 'instant',
        });
      scrollPosition.current = element.scrollTop;
    });
    observer.observe(element);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [paged]);
  useEffect(() => {
    const controller = new AbortController();
    // Remote images are loaded once into the displayed page by its bounded queue.
    // Preloading their no-store API URLs separately downloads them twice.
    if (chapter.kind === 'remote') return () => controller.abort();
    const current = container.current.querySelector(`[data-page="${page}"] img`);
    // Give the page being read first use of the connection, then keep a small rolling buffer.
    const prepare = () =>
      pages
        .slice(page, page + 5)
        .filter((item) => !item.blob)
        .forEach((item) => {
          try {
            warmImage(
              chapter.kind === 'remote' ? readerContextPath(item.url, context) : item.url,
              controller.signal,
            );
          } catch {
            /* Expired/pending context cannot start another page request. */
          }
        });
    if (current?.complete && current.naturalWidth) prepare();
    else current?.addEventListener('load', prepare, { once: true });
    return () => {
      controller.abort();
      current?.removeEventListener('load', prepare);
    };
  }, [pages, page, paged, readerContextKey(context)]);
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
    if (!paged) {
      onToggleControls();
      return;
    }
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
            key={`${chapter.id}:${index}`}
            page={item}
            context={context}
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
