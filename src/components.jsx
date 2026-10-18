import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Plus,
  Star,
  X,
  Sparkles,
} from 'lucide-react';
import { kindOf, scoreOf, titleOf, send } from './api';
import { useApp } from './state';
import { dialogStack, lockDocumentScroll } from './overlays';
import CoverImage from './CoverImage';
import PrefetchLink from './PrefetchLink';
export function Button({ children, variant = 'primary', className = '', busy, ...props }) {
  return (
    <button
      className={`btn btn-${variant} ${className}`}
      {...props}
      disabled={busy || props.disabled}
    >
      {busy && <LoaderCircle className="spin" size={16} />}
      {children}
    </button>
  );
}
export function Empty({ icon: Icon = Sparkles, title, children, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={27} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function ErrorNotice({ message, retry }) {
  return (
    <div className="error-notice" role="alert">
      <CircleAlert size={19} />
      <span>{message}</span>
      {retry && <button onClick={retry}>Try again</button>}
    </div>
  );
}
export function Loading({ cards = false }) {
  return cards ? (
    <div className="poster-grid" aria-label="Loading titles">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="skeleton-card" key={i}>
          <div />
          <span />
          <small />
        </div>
      ))}
    </div>
  ) : (
    <div className="loading" role="status">
      <LoaderCircle className="spin" />
      Finding your next obsession…
    </div>
  );
}
export function Avatar({ user, size = 'normal' }) {
  return (
    <span
      className={`avatar avatar-${size}`}
      style={{
        '--avatar-color': `hsl(${(String(user?.name || '?').charCodeAt(0) * 13) % 360} 42% 35%)`,
      }}
    >
      {user?.avatar && /^https:\/\//.test(user.avatar) ? (
        <img src={user.avatar} alt="" />
      ) : (
        (user?.name || '?').slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
export function Badge({ children, tone = '' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Poster({ media, rank, compact = false }) {
  const { entryFor, updateEntry } = useApp();
  const entry = entryFor(media);
  return (
    <article className="poster-card">
      <div className="poster-art">
        <PrefetchLink
          media={media}
          to={`/title/${media.id}`}
          className="poster-link"
          aria-label={`View ${titleOf(media)}`}
        >
          <CoverImage media={media} alt={titleOf(media)} loading="lazy" decoding="async" />
          <span className="poster-shade" />
          <span className="poster-open">
            <ArrowUpRight size={24} />
          </span>
        </PrefetchLink>
        <span className={`media-kind kind-${kindOf(media).toLowerCase()}`}>
          {compact ? media.format || kindOf(media) : kindOf(media).toLowerCase()}
        </span>
        <button
          className={`save-poster ${entry ? 'saved' : ''}`}
          onClick={() =>
            updateEntry(media, { status: entry?.status || 'planned', favorite: !entry?.favorite })
          }
          aria-label={`${entry?.favorite ? 'Unfavorite' : 'Favorite'} ${titleOf(media)}`}
        >
          {entry?.favorite ? <Check size={16} /> : <Plus size={17} />}
        </button>
        {scoreOf(media) > 0 && (
          <span className="poster-score">
            <Star size={12} fill="currentColor" />
            {scoreOf(media).toFixed(1)}
          </span>
        )}
        {rank && <span className="poster-rank">{String(rank).padStart(2, '0')}</span>}
      </div>
      <PrefetchLink media={media} className="poster-title" to={`/title/${media.id}`}>
        {titleOf(media)}
      </PrefetchLink>
      <div className="poster-meta">
        <span>{media.year || media.format || 'Series'}</span>
        <span className="dot" />
        <span>{media.genres?.[0] || (media.type === 'ANIME' ? 'Anime' : 'Comics')}</span>
      </div>
    </article>
  );
}
export function Section({ eyebrow, title, href, linkLabel = 'View all', children, controls }) {
  return (
    <section className="content-section">
      <div className="section-heading">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        <div className="section-actions">
          {controls}
          {href && (
            <Link to={href} className="text-link">
              {linkLabel}
              <ArrowRight size={15} />
            </Link>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
export function PosterRail({ items }) {
  const rail = useRef();
  return (
    <div className="rail-wrap">
      <div ref={rail} className="poster-rail">
        {items.map((media) => (
          <Poster key={media.id} media={media} />
        ))}
      </div>
      <button
        className="rail-next"
        aria-label="Scroll titles right"
        onClick={() => rail.current.scrollBy({ left: 500, behavior: 'smooth' })}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
export function Modal({ title, children, close, wide = false }) {
  const panel = useRef();
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const before = document.activeElement;
    const unlockScroll = lockDocumentScroll();
    const el = panel.current;
    dialogStack.push(el);
    el?.querySelector('input,button')?.focus();
    const onKey = (e) => {
      if (dialogStack.at(-1) !== el) return;
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const focusable = [
          ...el.querySelectorAll(
            'a[href],button:not([disabled]),input:not([disabled]),textarea,select,[tabindex="0"]',
          ),
        ].filter((x) => x.offsetParent !== null);
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      const wasTopmost = dialogStack.at(-1) === el;
      const index = dialogStack.indexOf(el);
      if (index >= 0) dialogStack.splice(index, 1);
      unlockScroll();
      document.removeEventListener('keydown', onKey);
      if (wasTopmost && before?.isConnected) before.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={panel}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button className="modal-close icon-button" aria-label="Close dialog" onClick={close}>
          <X size={20} />
        </button>
        {children}
      </section>
    </div>
  );
}
export function AuthModal() {
  const { authOpen, setAuthOpen, setUser, config, notify } = useApp();
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!authOpen) return null;
  const submit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError('');
    try {
      const data = await send(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, body);
      setUser(data.user);
      setAuthOpen(false);
      notify(`Welcome${mode === 'login' ? ' back' : ''}, ${data.user.name}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={mode === 'login' ? 'Sign in to Yoru' : 'Create your Yoru account'}
      close={() => setAuthOpen(false)}
    >
      <div className="auth-brand">
        <img src="/icon.svg" alt="" />
        yoru<span>夜</span>
      </div>
      <span className="eyebrow">YOUR PEOPLE. YOUR STORIES.</span>
      <h2>{mode === 'login' ? 'Welcome back.' : 'Find your people.'}</h2>
      <p className="muted">
        Your favorites, late-night theories, and next chapter. All in one place.
      </p>
      {config.auth?.discord && (
        <a href="/api/auth/discord" className="btn btn-discord">
          Continue with Discord
        </a>
      )}
      {error && <ErrorNotice message={error} />}
      <form onSubmit={submit} className="form-stack">
        {mode === 'register' && (
          <label>
            Display name
            <input
              name="name"
              autoComplete="nickname"
              required
              minLength={2}
              maxLength={40}
              placeholder="What should we call you?"
            />
          </label>
        )}
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            maxLength={254}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'login' ? 1 : 10}
            maxLength={128}
            placeholder={mode === 'login' ? 'Your password' : 'At least 10 characters'}
          />
        </label>
        <Button busy={busy} type="submit">
          {mode === 'login' ? 'Sign in' : 'Create account'}
          <ArrowRight size={17} />
        </Button>
      </form>
      <p className="auth-switch">
        {mode === 'login' ? 'New around here?' : 'Already part of the club?'}{' '}
        <button
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
        >
          {mode === 'login' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </Modal>
  );
}
