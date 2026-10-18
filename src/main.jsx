import React, { Suspense, lazy, useEffect, useRef, useState, useMemo } from 'react';
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
import { AppProvider, useApp, useRawResource } from './state';
import { AuthModal, Avatar, Loading } from './components';
import Home from './pages/Home';
import Browse from './pages/Browse';
import { setupWebMCP } from './webmcp';
import { NsfwButton, AraAraBrand, AraAraNavigation, LegacyNsfwRedirect } from './nsfw';
import { CollectionContext, useCollection } from './collection-context';
import { confirmationKey } from './nsfw';
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
const CommunityThread = lazy(() => import('./pages/CommunityThread'));
const ForumTopic = lazy(() => import('./pages/ForumTopic'));
const Rooms = lazy(() => import('./pages/Rooms'));
const Room = lazy(() => import('./pages/Room'));
const Watch = lazy(() => import('./pages/Watch'));
const WatchLatest = lazy(() => import('./pages/WatchLatest'));
const Reader = lazy(() => import('./reader/Reader'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Schedule = lazy(() => import('./pages/Schedule'));
const MangaPage = lazy(() => import('./pages/MangaPage'));
const AnimePage = lazy(() => import('./pages/AnimePage'));
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
function CollectionBoundary({ children }) {
  const { pathname } = useLocation();
  const active = /^\/ara-ara(?:\/|$)/.test(pathname);
  const [sessionConfirmed, setSessionConfirmed] = useState(false);
  useEffect(() => {
    const update = (event) => setSessionConfirmed(Boolean(event.detail?.confirmed));
    window.addEventListener('ara-confirmation', update);
    return () => window.removeEventListener('ara-confirmation', update);
  }, []);
  let confirmed = sessionConfirmed;
  try {
    confirmed = sessionConfirmed || sessionStorage.getItem(confirmationKey) === '1';
  } catch {}
  const result = useRawResource(active && confirmed ? '/api/ara-ara/catalog' : null);
  const scope = useMemo(
    () => ({
      active,
      confirmed,
      catalog: result.data,
      loading: result.loading,
      error: result.error,
      refresh: result.refresh,
    }),
    [active, confirmed, result.data, result.loading, result.error, result.refresh],
  );
  return <CollectionContext.Provider value={scope}>{children}</CollectionContext.Provider>;
}
function Shell() {
  useTheme();
  const { user, setAuthOpen, visitors, toast, refreshLibrary } = useApp();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const location = useLocation();
  const scope = useCollection();
  const isHome = location.pathname === '/' || location.pathname === '/ara-ara';
  const isAraAra = /^\/(ara-ara|nsfw)(\/|$)/.test(location.pathname);
  useEffect(() => {
    document.title = isAraAra ? 'Ara Ara · 18+' : 'Yoru · A little more obsessed';
  }, [isAraAra]);
  const isReader = /^\/(ara-ara\/)?read\//.test(location.pathname);
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
            ? `home-shell${!isHome ? ' browse-shell' : ''}${isAraAra ? ' ara-shell' : ''}`
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
              {isAraAra ? <AraAraBrand /> : <Brand />}
              {isAraAra ? (
                <AraAraNavigation />
              ) : (
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
                  <NsfwButton />
                </nav>
              )}
            </>
          )}
          <div className="topbar-context">
            <span className="live-dot" />
            YOUR NEXT OBSESSION STARTS HERE
          </div>
          <GlobalSearch
            key={isAraAra ? 'ara' : 'yoru'}
            inputRef={input}
            collection={isAraAra ? scope : null}
          />
          <Link className="online-pill" to={isAraAra ? '/ara-ara/community' : '/community'}>
            <span className={`live-dot ${!visitors.connected ? 'muted-dot' : ''}`} />
            <strong>{visitors.connected ? visitors.data?.count || 0 : '—'}</strong>
            <span>online</span>
          </Link>
          {user ? (
            <Link
              to={isAraAra ? '/ara-ara/library' : '/library'}
              className="header-avatar"
              aria-label="Your library"
            >
              <Avatar user={user} />
            </Link>
          ) : (
            <button className="btn btn-small btn-primary" onClick={() => setAuthOpen(true)}>
              Sign in
              <ArrowRight size={15} />
            </button>
          )}
          <Link
            to={isAraAra ? '/ara-ara/settings' : '/settings'}
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
              <Route path="/browse/anime" element={<AnimePage />} />
              <Route path="/browse/manga" element={<MangaPage key="manga" />} />
              <Route path="/browse/manhwa" element={<MangaPage key="manhwa" category="manhwa" />} />
              <Route path="/browse/:category" element={<Browse />} />
              <Route path="/ara-ara/*" element={<NsfwPage />} />
              <Route path="/nsfw" element={<LegacyNsfwRedirect />} />
              <Route path="/nsfw/:category" element={<LegacyNsfwRedirect />} />
              <Route path="/title/:id" element={<Title />} />
              <Route path="/watch/:id/:unit" element={<Watch />} />
              <Route path="/watch/:id/latest" element={<WatchLatest />} />
              <Route path="/read/:id/:unit" element={<Reader />} />
              <Route element={<SpaceLayout />}>
                <Route path="/library" element={<Library />} />
                <Route path="/community" element={<Community />} />
                <Route path="/community/forum/:topicId" element={<ForumTopic />} />
                <Route path="/community/:id/:unit" element={<CommunityThread />} />
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
          <CollectionBoundary>
            <Shell />
          </CollectionBoundary>
        </AppProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register('/sw.js').catch(() => {});
