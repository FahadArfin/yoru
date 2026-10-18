import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from '../collection-router';
import { ArrowRight, ArrowUp, MessageCircle, Pause, Play } from 'lucide-react';
import { ago, api, isAnime, itemsOf, titleOf } from '../api';
import { Avatar } from '../components';
import { useApp } from '../state';
import '../live-comments.css';
import { useCollection } from '../collection-context';
import { commentPreview } from '../../shared/comment-media';

function useCommentFeed() {
  const scoped = useCollection()?.active;
  const [feed, setFeed] = useState({ data: null, loading: true, error: '' });
  const request = useRef(null);
  const refresh = useCallback(() => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    api(`/api/community?type=comment${scoped ? '&collection=ara-ara' : ''}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setFeed({ data, loading: false, error: '' });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setFeed((old) => ({ ...old, loading: false, error: error.message }));
      })
      .finally(() => {
        if (request.current === controller) request.current = null;
      });
  }, [scoped]);
  useEffect(() => {
    refresh();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [refresh]);
  return { ...feed, refresh };
}

export default function LiveComments() {
  const feed = useCommentFeed();
  const { event, connected } = useApp();
  const section = useRef(null);
  const viewport = useRef(null);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [items, setItems] = useState([]);
  const held = paused || hovered || focused;
  const next = useMemo(
    () =>
      itemsOf(feed.data)
        .filter((item) => item.kind === 'comment' && !item.media?.isAdult)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20),
    [feed.data],
  );
  const pending = next.filter((item) => !items.some((old) => old.id === item.id)).length;
  // Removed comments disappear even when the reader has paused the ticker.
  const shown = items.filter((item) => next.some((latest) => latest.id === item.id));
  const incoming = useRef(false);
  const refreshTimer = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(section.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () =>
      setReduced(media.matches || document.documentElement.dataset.reduceMotion === 'true');
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-reduce-motion'],
    });
    media.addEventListener('change', update);
    update();
    return () => {
      observer.disconnect();
      media.removeEventListener('change', update);
    };
  }, []);
  useEffect(() => {
    if (!['comments', 'snapshot'].includes(event?.type) || document.hidden) return;
    if (!refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        feed.refresh();
      }, 300);
  }, [event, feed.refresh]);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden && visible) feed.refresh();
    };
    const timer = setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    if (visible) refresh();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [visible, feed.refresh]);
  useEffect(() => {
    if (held && items.length) return;
    incoming.current = Boolean(
      items.length && next[0] && !items.some((item) => item.id === next[0].id),
    );
    setItems(next);
  }, [next, held]);
  useLayoutEffect(() => {
    if (incoming.current && viewport.current && !reduced)
      viewport.current.scrollTo({ top: 0, behavior: 'smooth' });
    incoming.current = false;
  }, [items, reduced]);
  useEffect(() => {
    if (!visible || held || reduced || shown.length < 4) return;
    const timer = setInterval(() => {
      const node = viewport.current;
      if (!node || document.hidden) return;
      const step = node.querySelector('li')?.getBoundingClientRect().height || 92;
      const atEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 2;
      node.scrollTo({ top: atEnd ? 0 : node.scrollTop + step + 8, behavior: 'smooth' });
    }, 6500);
    return () => clearInterval(timer);
  }, [visible, held, reduced, shown.length]);

  const showLatest = () => {
    setItems(next);
    setPaused(true);
    viewport.current?.scrollTo({ top: 0, behavior: reduced ? 'instant' : 'smooth' });
  };
  return (
    <section className="live-comments" aria-label="Live comments" ref={section}>
      <header className="live-comments-heading">
        <div>
          <MessageCircle size={17} />
          <h2>Live comments</h2>
          <span className={`live-comments-status ${connected && !feed.error ? 'is-live' : ''}`}>
            <i />
            {feed.error ? 'Reconnecting' : connected ? 'Live' : 'Connecting'}
          </span>
        </div>
        <Link to="/community">
          Community <ArrowRight size={14} />
        </Link>
      </header>
      <div className="live-comments-body">
        <aside className="live-comments-mascot" aria-hidden="true">
          <img src="/holo-comments.png" alt="" width="160" height="270" loading="lazy" />
          <span>A little more conversation.</span>
        </aside>
        <div className="live-comments-feed">
          <div className="live-comments-toolbar">
            <span>Across anime, manga & manhwa</span>
            {pending > 0 && items.length > 0 && (
              <button onClick={showLatest}>
                <ArrowUp size={12} />
                {pending} new
              </button>
            )}
            {reduced ? (
              <span className="live-comments-motion-off">Auto-scroll off</span>
            ) : (
              <button
                onClick={() => setPaused(!paused)}
                aria-label={
                  paused
                    ? 'Resume automatic comment scrolling'
                    : 'Pause automatic comment scrolling'
                }
                aria-pressed={paused}
              >
                {paused ? <Play size={13} /> : <Pause size={13} />}
                {paused ? 'Resume' : 'Pause'}
              </button>
            )}
          </div>
          <div
            className="live-comments-viewport"
            ref={viewport}
            tabIndex={0}
            aria-label="Recent comments"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
            }}
            onTouchStart={() => setPaused(true)}
            onWheel={() => setPaused(true)}
          >
            {shown.length > 0 ? (
              <ul className="live-comments-list">
                {shown.map((item) => (
                  <li key={item.id}>
                    <Link
                      className="live-comment-card"
                      to={`/title/${item.mediaId}?unit=${Number(item.unit) || 0}`}
                    >
                      <Avatar user={item.author} size="small" />
                      <div className="live-comment-copy">
                        <div className="live-comment-byline">
                          <strong>{item.author?.name || 'Member'}</strong>
                          <time dateTime={item.createdAt}>{ago(item.createdAt)}</time>
                        </div>
                        <span className="live-comment-title">
                          {item.media ? titleOf(item.media) : 'Title discussion'}
                          {item.unit > 0
                            ? ` · ${isAnime(item.media) || item.mediaId.startsWith('mal-anime-') ? 'Ep' : 'Ch'} ${item.unit}`
                            : ''}
                        </span>
                        <p>
                          {item.spoiler
                            ? 'Spoiler discussion — open to reveal'
                            : commentPreview(item.body)}
                        </p>
                      </div>
                      <ArrowRight className="live-comment-arrow" size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="live-comments-empty">
                <MessageCircle size={24} />
                <strong>
                  {feed.loading
                    ? 'Loading conversations…'
                    : feed.error
                      ? 'Comments are temporarily unavailable'
                      : 'The conversation starts with you.'}
                </strong>
                <span>
                  {feed.error
                    ? 'We’ll reconnect automatically.'
                    : 'Share a thought on a title or chapter. New comments appear here.'}
                </span>
                {feed.error ? (
                  <button onClick={feed.refresh}>Try again</button>
                ) : (
                  <Link to="/community">
                    Join the conversation <ArrowRight size={13} />
                  </Link>
                )}
              </div>
            )}
          </div>
          {feed.error && shown.length > 0 && (
            <p className="live-comments-reconnecting" role="status">
              Reconnecting — showing saved comments. <button onClick={feed.refresh}>Retry</button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
