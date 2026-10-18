import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { ArrowRight, Check, Settings } from 'lucide-react';
import { AppProvider, useApp } from './state';
import { AuthModal, Avatar, Loading } from './components';
import Home from './pages/Home';
import Browse from './pages/Browse';
import { setupWebMCP } from './webmcp';
import { NsfwMenu } from './nsfw';
import CategoryNavigation from './CategoryNavigation';
import GlobalSearch from './GlobalSearch';
import SiteFooter from './SiteFooter';
import SpaceLayout from './SpaceLayout';
import './styles.css';
import './home.css';
import './browse.css';
import './nsfw.css';
import './theme.css';
import { useTheme } from './theme';
const Title = lazy(() => import('./pages/Title'));
const Library = lazy(() => import('./pages/Library'));
const Community = lazy(() => import('./pages/Community'));
const Rooms = lazy(() => import('./pages/Rooms'));
const Room = lazy(() => import('./pages/Room'));
const Watch = lazy(() => import('./pages/Watch'));
const WatchLatest = lazy(() => import('./pages/WatchLatest'));
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
  useTheme();
  const { user, setAuthOpen, visitors, toast, refreshLibrary } = useApp();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const location = useLocation();
  const isHome = location.pathname === '/';
  const isReader = location.pathname.startsWith('/read/');
  const browseCategory = location.pathname.match(/^\/browse\/(anime|manga|manhwa)\/?$/)?.[1];
  const readingLanding =
    ['/browse/manga', '/browse/manhwa'].includes(location.pathname) &&
    !['q', 'genre', 'sort', 'page', 'view'].some((key) =>
      new URLSearchParams(location.search).get(key),
    );
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
        <header className={`topbar${browseCategory ? ' has-category-navigation' : ''}`}>
          {hasTopNavigation && (
            <>
              <Brand />
              <nav className="home-topnav" aria-label="Explore Yoru">
                <NavLink to="/browse/anime">Anime</NavLink>
                <NavLink to="/browse/manga">Manga</NavLink>
                <NavLink to="/browse/manhwa">Manhwa</NavLink>
                <Link to="/schedule">Schedule</Link>
                <Link
                  to="/community"
                  className={
                    ['/community', '/library', '/rooms'].some(
                      (path) =>
                        location.pathname === path || location.pathname.startsWith(path + '/'),
                    )
                      ? 'active'
                      : ''
                  }
                >
                  My Space
                </Link>
                <NsfwMenu />
              </nav>
            </>
          )}
          <div className="topbar-context">
            <span className="live-dot" />
            YOUR NEXT OBSESSION STARTS HERE
          </div>
          <GlobalSearch inputRef={input} />
          <Link className="online-pill" to="/community">
            <span className={`live-dot ${!visitors.connected ? 'muted-dot' : ''}`} />
            <strong>{visitors.connected ? visitors.data?.count || 0 : '—'}</strong>
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
          {browseCategory && <CategoryNavigation key={browseCategory} category={browseCategory} />}
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
              <Route path="/watch/:id/latest" element={<WatchLatest />} />
              <Route path="/read/:id/:unit" element={<Reader />} />
              <Route element={<SpaceLayout />}>
                <Route path="/library" element={<Library />} />
                <Route path="/community" element={<Community />} />
                <Route path="/rooms" element={<Rooms />} />
              </Route>
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
        <SiteFooter />
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
