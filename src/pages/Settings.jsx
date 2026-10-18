import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  Download,
  Link2,
  LogOut,
  MonitorSmartphone,
  Moon,
  RefreshCw,
  ShieldCheck,
  Settings2,
} from 'lucide-react';
import { useApp, useResource } from '../state';
import { send } from '../api';
import { Avatar, Badge, Button, ErrorNotice } from '../components';
import { useWebMCPStatus } from '../webmcp-state';
import '../section-pages.css';
import '../settings-page.css';
export default function Settings() {
  const webmcp = useWebMCPStatus();
  const { user, setAuthOpen, config, refreshLibrary, notify, logout } = useApp();
  const mal = useResource(user ? '/api/mal/status' : null, false);
  const [syncing, setSyncing] = useState(false);
  const [malError, setMalError] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [install, setInstall] = useState(null);
  const [reduced, setReduced] = useState(() => {
    try {
      return localStorage.getItem('yoru:reduce-motion') === 'true';
    } catch {
      return false;
    }
  });
  const syncMal = async () => {
    setSyncing(true);
    setMalError('');
    try {
      const result = await send('/api/mal/sync', {});
      if (!active.current) return;
      await refreshLibrary();
      if (!active.current) return;
      mal.refresh();
      notify(result.message || `${result.imported} titles synced from MAL`);
    } catch (error) {
      if (active.current) setMalError(error.message);
    } finally {
      if (active.current) setSyncing(false);
    }
  };
  const disconnectMal = async () => {
    setMalError('');
    try {
      await send('/api/mal/disconnect', {});
      if (!active.current) return;
      mal.refresh();
      notify('MyAnimeList disconnected. Your library is still here.');
    } catch (error) {
      if (active.current) setMalError(error.message);
    }
  };
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(reduced);
    try {
      localStorage.setItem('yoru:reduce-motion', String(reduced));
    } catch {}
  }, [reduced]);
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  return (
    <div className="page section-page settings-page">
      <header className="section-page-heading">
        <div>
          <span className="section-kicker">
            <Settings2 size={13} /> MAKE YOURSELF AT HOME
          </span>
          <h1>Settings</h1>
          <p>Your corner of Yoru. Manage your account, collection, and everyday comforts.</p>
        </div>
        <div className="section-heading-note">
          <Moon size={14} /> A little more you
        </div>
      </header>
      <div className="settings-grid">
        <div className="settings-column">
          <section className="panel settings-card" aria-labelledby="settings-account">
            <div className="panel-heading">
              <span className="settings-card-icon">
                <ShieldCheck size={20} />
              </span>
              <div>
                <span className="settings-label">YOUR SPACE</span>
                <h2 id="settings-account">Your account</h2>
              </div>
            </div>
            {user ? (
              <div className="settings-user">
                <Avatar user={user} />
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.email || 'Connected through Discord'}</span>
                </div>
                <button
                  className="icon-button"
                  onClick={logout}
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <>
                <p>Your library, reviews, and progress sync to your account.</p>
                <Button onClick={() => setAuthOpen(true)}>
                  Sign in to Yoru
                  <ArrowRight size={16} />
                </Button>
              </>
            )}
            <div className="setting-row">
              <div>
                <strong>Discord sign-in</strong>
                <span>
                  {config.auth?.discord
                    ? 'Connect through your Discord account.'
                    : 'Discord sign-in is not available yet.'}
                </span>
              </div>
              <Badge tone={config.auth?.discord ? 'green' : ''}>
                {config.auth?.discord ? 'AVAILABLE' : 'UNAVAILABLE'}
              </Badge>
            </div>
            {config.auth?.discord && (
              <a className="text-link" href="/api/auth/discord">
                Continue with Discord
                <ArrowRight size={15} />
              </a>
            )}
          </section>
          <section className="panel settings-card" aria-labelledby="settings-collection">
            <div className="panel-heading">
              <span className="settings-card-icon">
                <Link2 size={20} />
              </span>
              <div>
                <span className="settings-label">YOUR STORIES, TOGETHER</span>
                <h2 id="settings-collection">Connected library</h2>
              </div>
            </div>
            <p>
              Bring your anime and manga lists from MyAnimeList. Your stories should travel with
              you.
            </p>
            {user && mal.loading && !mal.data ? (
              <p className="settings-connection-status" role="status">
                Checking your MyAnimeList connection…
              </p>
            ) : mal.error ? (
              <ErrorNotice message={mal.error} retry={mal.refresh} />
            ) : mal.data?.connected ? (
              <div className="mal-connection">
                <div className="setting-row">
                  <div>
                    <strong>Connected as {mal.data.username}</strong>
                    <span>
                      {mal.data.lastSyncedAt
                        ? `Last synced ${new Date(mal.data.lastSyncedAt).toLocaleString()}`
                        : 'Ready for your first sync'}
                    </span>
                  </div>
                  <Badge tone="green">CONNECTED</Badge>
                </div>
                <p className="small muted">
                  Sync copies MAL status, progress, and ratings into Yoru. Matching Yoru entries are
                  updated; your existing favorites and other titles stay. Nothing is written back to
                  MAL.
                </p>
                <div className="heading-buttons">
                  <Button busy={syncing} onClick={syncMal}>
                    <RefreshCw size={16} />
                    Sync from MAL
                  </Button>
                  <Button variant="subtle" onClick={disconnectMal} disabled={syncing}>
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : mal.data?.configured && user ? (
              <a className="btn btn-secondary" href="/api/mal/connect">
                Connect MyAnimeList
                <Link2 size={16} />
              </a>
            ) : !user ? (
              <div className="settings-connect-note">
                <p>Sign in to manage your MyAnimeList connection and saved library.</p>
                <Button variant="secondary" onClick={() => setAuthOpen(true)}>
                  Sign in to connect <ArrowRight size={16} />
                </Button>
              </div>
            ) : (
              <p className="small muted">
                MyAnimeList account connection is not available yet. You can still import an XML
                list from your library.
              </p>
            )}
            {malError && <ErrorNotice message={malError} />}
            <Link className="settings-library-link" to="/library">
              Import or export your library
              <ArrowRight size={16} />
            </Link>
            <details className="settings-details">
              <summary>
                How favorites are imported <ChevronDown size={14} />
              </summary>
              <p>
                MAL’s regular API and XML exports omit favorites. Use “Import MAL favorites” in your
                library to bring over a public profile’s favorites, or mark them in Yoru. They’re
                preserved during list sync.
              </p>
            </details>
          </section>
        </div>
        <div className="settings-column">
          <section className="panel settings-card" aria-labelledby="settings-comfort">
            <div className="panel-heading">
              <span className="settings-card-icon">
                <Moon size={20} />
              </span>
              <div>
                <span className="settings-label">MAKE IT YOURS</span>
                <h2 id="settings-comfort">Viewing comfort</h2>
              </div>
            </div>
            <label className="setting-row">
              <div>
                <strong>Reduce motion</strong>
                <span id="motion-description">
                  Keep transitions subtle and stop decorative animations.
                </span>
              </div>
              <input
                className="switch"
                aria-label="Reduce motion"
                aria-describedby="motion-description"
                type="checkbox"
                checked={reduced}
                onChange={(e) => setReduced(e.target.checked)}
              />
            </label>
            <p className="small muted">
              This preference is saved on this device. Your system’s reduced motion setting is also
              respected.
            </p>
          </section>
          <section className="panel settings-card" aria-labelledby="settings-install">
            <div className="panel-heading">
              <span className="settings-card-icon">
                <MonitorSmartphone size={20} />
              </span>
              <div>
                <span className="settings-label">ALWAYS CLOSE</span>
                <h2 id="settings-install">Take Yoru with you</h2>
              </div>
            </div>
            <p>Install Yoru on your home screen for a focused, app-like experience.</p>
            {install ? (
              <Button
                onClick={async () => {
                  await install.prompt();
                  setInstall(null);
                }}
              >
                <Download size={17} />
                Install Yoru
              </Button>
            ) : (
              <div className="install-hint">
                <div>
                  <strong>Android</strong>
                  <span>Chrome → Menu → Add to Home screen → Install.</span>
                </div>
                <div>
                  <strong>iPhone & iPad</strong>
                  <span>Safari → Share → Add to Home Screen.</span>
                </div>
              </div>
            )}
          </section>
        </div>
        <section className="panel settings-card about-card" aria-labelledby="settings-about">
          <div className="settings-about-intro">
            <div className="auth-brand">
              <img src="/icon.svg" alt="" />
              yoru<span>夜</span>
            </div>
            <h2 id="settings-about">Made for the “one more” people.</h2>
            <p>
              One more episode. One more chapter. One more theory at 2 a.m. Yoru is a home for
              everything you can’t stop watching, reading, and talking about.
            </p>
          </div>
          <div className="settings-about-meta">
            <div className="about-badges">
              <Badge>ANIME</Badge>
              <Badge>MANGA</Badge>
              <Badge>MANHWA</Badge>
              <Badge>
                {webmcp.pending
                  ? 'CONNECTING WEBMCP'
                  : webmcp.registered
                    ? `${webmcp.registered} WEBMCP TOOLS`
                    : 'WEBMCP AVAILABLE'}
              </Badge>
            </div>
            <p className="small muted">
              Metadata comes from MyAnimeList via Tenrai and Kitsu; ratings display their source.
              Yoru links to video providers and offers manga reading from credited sources. Native
              WebMCP tools are enabled when supported by your browser.
            </p>
            <p className="small muted" role="status">
              {!webmcp.supported
                ? 'Agent tools need a browser with WebMCP support. All regular controls work in this browser.'
                : webmcp.failed
                  ? 'Some agent tools could not register. Reload this page to retry.'
                  : webmcp.pending
                    ? 'Registering agent tools…'
                    : `${webmcp.registered} tools connected: search, library, sources, and episode navigation.`}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
