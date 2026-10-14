import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
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
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  CalendarDays,
  Check,
  ChevronDown,
  Compass,
  Heart,
  LogOut,
  Menu,
  MessageCircle,
  MonitorPlay,
  Moon,
  Search,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { AppProvider, useApp } from './state';
import { AuthModal, Avatar, Loading } from './components';
import Home from './pages/Home';
import Browse from './pages/Browse';
import { setupWebMCP } from './webmcp';
import { lockDocumentScroll } from './overlays';
import './styles.css';
import './home.css';
const Title = lazy(() => import('./pages/Title'));
const Library = lazy(() => import('./pages/Library'));
const Community = lazy(() => import('./pages/Community'));
const Rooms = lazy(() => import('./pages/Rooms'));
const Room = lazy(() => import('./pages/Room'));
const Watch = lazy(() => import('./pages/Watch'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Schedule = lazy(() => import('./pages/Schedule'));
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
  const { user, setAuthOpen, online, connected, logout, toast, config, refreshLibrary } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const location = useLocation();
  const isHome = location.pathname === '/';
  const input = useRef();
  const navigation = useRef();
  const navigationTrigger = useRef();
  useEffect(() => {
    setNavOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') setNavOpen(false);
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setNavOpen(false);
        requestAnimationFrame(() => input.current?.focus());
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!navOpen) return;
    const panel = navigation.current;
    const unlockScroll = lockDocumentScroll();
    const focusable = () =>
      [...panel.querySelectorAll('a[href],button:not([disabled])')].filter(
        (element) => element.getClientRects().length,
      );
    focusable()[0]?.focus();
    const trap = (event) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const desktop = window.matchMedia('(min-width: 761px)');
    const resize = () => {
      if (desktop.matches) setNavOpen(false);
    };
    panel.addEventListener('keydown', trap);
    desktop.addEventListener('change', resize);
    return () => {
      panel.removeEventListener('keydown', trap);
      desktop.removeEventListener('change', resize);
      unlockScroll();
      navigationTrigger.current?.focus();
    };
  }, [navOpen]);
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
  const nav = (to, Icon, text, tag) => (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
    >
      <Icon size={19} />
      <span>{text}</span>
      {tag && <small>{tag}</small>}
    </NavLink>
  );
  return (
    <div className={isHome ? 'home-shell' : undefined}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {navOpen && (
        <button
          className="nav-overlay"
          tabIndex={-1}
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside
        ref={navigation}
        id="site-navigation"
        role={navOpen ? 'dialog' : undefined}
        aria-modal={navOpen || undefined}
        aria-label={navOpen ? 'Navigation' : undefined}
        className={`sidebar ${navOpen ? 'is-open' : ''}`}
      >
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          >
            <X />
          </button>
        </div>
        <div className="sidebar-tagline">A little more obsessed.</div>
        <nav aria-label="Main navigation">
          <span className="nav-label">YOUR UNIVERSE</span>
          {nav('/', Compass, 'Discover')}
          {nav('/browse/anime', MonitorPlay, 'Anime')}
          {nav('/browse/manga', BookOpen, 'Manga')}
          {nav('/browse/manhwa', Sparkles, 'Manhwa')}
          {nav('/library', Bookmark, 'My library')}
          {nav('/schedule', CalendarDays, 'Schedule')}
          <span className="nav-label nav-label-second">BETTER TOGETHER</span>
          {nav('/community', MessageCircle, 'Community')}
          {nav('/rooms', Users, 'Watch & read', 'LIVE')}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-promo">
            <span className="moon-orbit">
              <Moon size={26} />
              <Sparkles size={14} />
            </span>
            <strong>Same story. Together.</strong>
            <p>Turn one more episode into a night with your people.</p>
            <Link to="/rooms">
              Find your room <ArrowRight size={14} />
            </Link>
          </div>
          {nav('/settings', Settings, 'Settings')}
          {user ? (
            <div className="sidebar-profile">
              <Avatar user={user} />
              <Link to="/library">
                <strong>{user.name}</strong>
                <span>Your personal universe</span>
              </Link>
              <button className="icon-button" onClick={logout} aria-label="Sign out">
                <LogOut size={17} />
              </button>
            </div>
          ) : (
            <button
              className="sidebar-signin"
              onClick={() => {
                setNavOpen(false);
                setAuthOpen(true);
              }}
            >
              <span className="avatar">
                <Heart size={18} />
              </span>
              <span>
                <strong>Make yourself at home</strong>
                <small>Join the Yoru community</small>
              </span>
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </aside>
      <div className="app-main" inert={navOpen}>
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            aria-label="Open navigation"
            ref={navigationTrigger}
            aria-expanded={navOpen}
            aria-controls="site-navigation"
            onClick={() => setNavOpen(true)}
          >
            <Menu />
          </button>
          {isHome && (
            <>
              <Brand />
              <nav className="home-topnav" aria-label="Explore Yoru">
                <Link to="/browse/anime">Anime</Link>
                <Link to="/browse/manga">Manga</Link>
                <Link to="/browse/manhwa">Manhwa</Link>
                <Link to="/schedule">Schedule</Link>
                <Link to="/community">Community</Link>
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
        </header>
        <main id="main-content" tabIndex={-1}>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/browse/:category" element={<Browse />} />
              <Route path="/title/:id" element={<Title />} />
              <Route path="/watch/:id/:unit" element={<Watch />} />
              <Route path="/read/:id/:unit" element={<Watch />} />
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
            Metadata from MyAnimeList via Jikan and Kitsu. Media belongs to its respective owners.
            <br />
            Yoru links to external providers. No video or comic files are hosted here.
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
