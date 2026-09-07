import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Download,
  Globe,
  Link2,
  MessageCircle,
  MonitorSmartphone,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useApp, useResource } from '../state';
import { send } from '../api';
import { Avatar, Badge, Button, ErrorNotice } from '../components';
export default function Settings() {
  const { user, setAuthOpen, config, refreshLibrary, notify } = useApp();
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
    <div className="page settings-page">
      <div className="page-heading">
        <span className="eyebrow">MAKE YOURSELF AT HOME</span>
        <h1>Your corner of Yoru.</h1>
        <p>A few little things to make your time here feel like you.</p>
      </div>
      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="panel-heading">
            <ShieldCheck size={21} />
            <h2>Your account</h2>
          </div>
          {user ? (
            <div className="settings-user">
              <Avatar user={user} />
              <div>
                <strong>{user.name}</strong>
                <span>{user.email || 'Connected through Discord'}</span>
              </div>
              <Badge tone="green">CONNECTED</Badge>
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
                  : 'Available when the site owner connects a Discord application.'}
              </span>
            </div>
            <Badge tone={config.auth?.discord ? 'green' : ''}>
              {config.auth?.discord ? 'AVAILABLE' : 'NOT CONNECTED'}
            </Badge>
          </div>
          {config.auth?.discord && (
            <a className="text-link" href="/api/auth/discord">
              Continue with Discord
              <ArrowRight size={15} />
            </a>
          )}
        </section>
        <section className="panel settings-card">
          <div className="panel-heading">
            <MonitorSmartphone size={21} />
            <h2>Take Yoru with you</h2>
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
              <strong>On Android</strong>
              <span>Open Yoru in Chrome → Menu → Add to Home screen → Install.</span>
              <strong>On iPhone or iPad</strong>
              <span>Open in Safari → Share → Add to Home Screen.</span>
            </div>
          )}
          <p className="small muted">
            An HTTPS deployment enables installation. A standalone Android APK will be a separate
            release.
          </p>
        </section>
        <section className="panel settings-card">
          <div className="panel-heading">
            <Moon size={21} />
            <h2>A little calmer</h2>
          </div>
          <label className="setting-row">
            <div>
              <strong>Reduce motion</strong>
              <span>Keep transitions subtle and stop decorative animations.</span>
            </div>
            <input
              className="switch"
              aria-label="Reduce motion"
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
        <section className="panel settings-card">
          <div className="panel-heading">
            <Link2 size={21} />
            <h2>Your collection travels</h2>
          </div>
          <p>
            Bring your anime and manga lists from MyAnimeList. Your stories should travel with you.
          </p>
          {mal.data?.connected ? (
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
          ) : (
            <p className="small muted">
              Account connection becomes available when the site owner configures a MyAnimeList
              application. XML importing works now.
            </p>
          )}
          {malError && <ErrorNotice message={malError} />}
          <Link className="btn btn-subtle" to="/library">
            Import or export your library
            <ArrowRight size={16} />
          </Link>
          <p className="small muted">
            MAL’s regular API and XML exports omit favorites. Use “Import MAL favorites” in your
            library to bring over a public profile’s favorites, or mark them in Yoru. They’re
            preserved during list sync.
          </p>
        </section>
        <section className="panel settings-card about-card">
          <div className="auth-brand">
            <img src="/icon.svg" alt="" />
            yoru<span>夜</span>
          </div>
          <h2>Made for the “one more” people.</h2>
          <p>
            One more episode. One more chapter. One more theory at 2 a.m. Yoru is a home for
            everything you can’t stop watching, reading, and talking about.
          </p>
          <div className="about-badges">
            <Badge>ANIME</Badge>
            <Badge>MANGA</Badge>
            <Badge>MANHWA</Badge>
            <Badge>WEBMCP READY</Badge>
          </div>
          <p className="small muted">
            Metadata comes from MyAnimeList via Jikan and Kitsu; ratings display their source. Yoru
            links to external media and does not host video or comic files. Native WebMCP tools are
            enabled when supported by your browser.
          </p>
        </section>
      </div>
    </div>
  );
}
