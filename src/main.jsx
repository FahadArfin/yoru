import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Search, Settings } from 'lucide-react';
import { AppProvider, useApp } from './state';
import { AuthModal, Avatar, Loading } from './components';
import Home from './pages/Home';
import Browse from './pages/Browse';
import { setupWebMCP } from './webmcp';
import { NsfwMenu } from './nsfw';
import './styles.css';
import './home.css';
import './browse.css';
import './nsfw.css';
const Title = lazy(() => import('./pages/Title'));
const Library = lazy(() => import('./pages/Library'));
const Community = lazy(() => import('./pages/Community'));
const Rooms = lazy(() => import('./pages/Rooms'));
const Room = lazy(() => import('./pages/Room'));
const Watch = lazy(() => import('./pages/Watch'));
const Reader = lazy(() => import('./reader/Reader'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Schedule = lazy(() => import('./pages/Schedule'));
const MangaPage = lazy(() => import('./pages/MangaPage'));
const NsfwPage = lazy(() => import('./pages/NsfwPage'));
function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Yoru home">
      <img src="/icon.svg" alt="" />
      <span>
        yoru<span className="brand-dot">.</span>
      </span>
      <small>夜</small>
    </Link>
  );
}
function Shell() {
  const { user, setAuthOpen, online, connected, toast, refreshLibrary } = useApp();
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const location = useLocation();
  const isHome = location.pathname === '/';
  const isReader = location.pathname.startsWith('/read/');
  const readingLanding =
    ['/browse/manga', '/browse/manhwa'].includes(location.pathname) &&
    !['q', 'genre', 'sort', 'page'].some((key) => new URLSearchParams(location.search).get(key));
  const hasTopNavigation = !isReader;
  const input = useRef();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);
  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        requestAnimationFrame(() => input.current?.focus());
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    try {
      document.documentElement.dataset.reduceMotion =
        localStorage.getItem('yoru:reduce-motion') || 'false';
    } catch {}
  }, []);
  useEffect(
    () => setupWebMCP((...args) => navigateRef.current(...args), { refreshLibrary }),
    [refreshLibrary],
  );
  return (
    <div
      className={
        isReader
          ? 'reader-shell'
          : hasTopNavigation
            ? `home-shell${!isHome && !readingLanding ? ' browse-shell' : ''}`
            : undefined
      }
    >
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <div className="app-main">
        <header className="topbar">
          {hasTopNavigation && (
            <>
              <Brand />
              <nav className="home-topnav" aria-label="Explore Yoru">
                <Link to="/browse/anime">Anime</Link>
                <Link to="/browse/manga">Manga</Link>
                <Link to="/browse/manhwa">Manhwa</Link>
                <Link to="/schedule">Schedule</Link>
                <Link to="/community">Community</Link>
                <Link to="/library">My library</Link>
                <Link to="/rooms">Watch &amp; read</Link>
                <NsfwMenu />
              </nav>
            </>
          )}
          <div className="topbar-context">
            <span className="live-dot" />
            YOUR NEXT OBSESSION STARTS HERE
          </div>
          <form
            className="global-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/browse/all?q=${encodeURIComponent(search)}`);
            }}
          >
            <Search size={18} />
            <input
              ref={input}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search anime, manga, and manhwa"
              placeholder="Search your next obsession…"
            />
            <kbd>Ctrl K</kbd>
          </form>
          <Link className="online-pill" to="/community">
            <span className={`live-dot ${!connected ? 'muted-dot' : ''}`} />
            <strong>{connected ? online.count || 0 : '—'}</strong>
            <span>online</span>
          </Link>
          {user ? (
            <Link to="/library" className="header-avatar" aria-label="Your library">
              <Avatar user={user} />
            </Link>
          ) : (
            <button className="btn btn-small btn-primary" onClick={() => setAuthOpen(true)}>
              Sign in
              <ArrowRight size={15} />
            </button>
          )}
          <Link
            to="/settings"
            className="icon-button header-settings"
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={19} />
          </Link>
        </header>
        <main id="main-content" tabIndex={-1}>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/browse/manga" element={<MangaPage key="manga" />} />
              <Route path="/browse/manhwa" element={<MangaPage key="manhwa" category="manhwa" />} />
              <Route path="/browse/:category" element={<Browse />} />
              <Route path="/nsfw" element={<NsfwPage />} />
              <Route path="/nsfw/:category" element={<NsfwPage />} />
              <Route path="/title/:id" element={<Title />} />
              <Route path="/watch/:id/:unit" element={<Watch />} />
              <Route path="/read/:id/:unit" element={<Reader />} />
              <Route path="/library" element={<Library />} />
              <Route path="/community" element={<Community />} />
              <Route path="/rooms" element={<Rooms />} />
              <Route path="/rooms/:id" element={<Room />} />
              <Route path="/settings" element={<SettingsPage key={user?.id || 'guest'} />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route
                path="*"
                element={
                  <div className="empty-state">
                    <h1>A little off the map.</h1>
                    <p>That page doesn’t exist.</p>
                    <Link className="btn btn-primary" to="/">
                      Back to discover
                    </Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </main>
        <footer className="site-footer">
          <div>
            <Brand />
            <span>Stories hit different when you share them.</span>
          </div>
          <p>
            Metadata from MyAnimeList via Tenrai and Kitsu. Media belongs to its respective owners.
            <br />
            Reading sources are credited in the reader. Availability depends on the provider.
          </p>
          <Link to="/settings">
            About Yoru <ArrowRight size={13} />
          </Link>
        </footer>
      </div>
      <AuthModal />
      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          <Check size={17} />
          {toast.text}
        </div>
      )}
    </div>
  );
}
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div className="fatal">
          <img src="/icon.svg" alt="Yoru" />
          <h1>Let’s get you back to your story.</h1>
          <p>The page had trouble loading. Your saved library is safe.</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload Yoru
          </button>
        </div>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AppProvider>
          <Shell />
        </AppProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register('/sw.js').catch(() => {});
