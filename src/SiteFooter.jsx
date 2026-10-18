import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, BookOpen, Compass, MonitorPlay, Users } from 'lucide-react';
import { Avatar, Modal } from './components';
import { useApp } from './state';
import './site-footer.css';

const genres = [
  'Action',
  'Romance',
  'Comedy',
  'Fantasy',
  'Sci-Fi',
  'Slice of Life',
  'Mystery',
  'Drama',
];
const activities = [
  [MonitorPlay, 'watching', 'Watching'],
  [BookOpen, 'reading', 'Reading'],
  [Compass, 'browsing', 'Browsing'],
];
export default function SiteFooter() {
  const { visitors } = useApp();
  const { pathname } = useLocation();
  const { data, connected } = visitors;
  const [open, setOpen] = useState(false);
  const count = (key) => (connected ? Number(data?.[key] || 0).toLocaleString() : '—');
  useEffect(() => setOpen(false), [pathname]);
  return (
    <footer className="community-footer" aria-label="Yoru footer">
      <button
        className="footer-presence"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="See who's online"
      >
        <span className="footer-presence-intro">
          <span className={`presence-signal ${connected ? 'is-live' : ''}`} />
          <span>
            <strong>{connected ? `${count('count')} online` : 'Community live status'}</strong>
            <small>Watchers, readers. Your people.</small>
          </span>
        </span>
        <span className="footer-presence-counts">
          {activities.map(([Icon, key, label]) => (
            <span key={key}>
              <Icon size={17} />
              <strong>{count(key)}</strong>
              <span>{label}</span>
            </span>
          ))}
        </span>
        <span className="footer-presence-action">
          Meet the community <ArrowUpRight size={17} />
        </span>
      </button>
      <div className="footer-main-grid">
        <div className="footer-story">
          <Link to="/" className="footer-wordmark" aria-label="Yoru home">
            yoru<span>.</span>
            <small>夜</small>
          </Link>
          <h2>A little more obsessed. Together.</h2>
          <p>
            Discover anime, manga and manhwa. Keep your place, find your next favorite, and share
            the stories that stay with you.
          </p>
          <Link className="footer-community-link" to="/community">
            <Users size={16} /> Find your people <ArrowUpRight size={14} />
          </Link>
        </div>
        <nav aria-label="Footer explore">
          <h3>Explore</h3>
          <Link to="/">Discover</Link>
          <Link to="/browse/anime">Anime</Link>
          <Link to="/browse/manga">Manga</Link>
          <Link to="/browse/manhwa">Manhwa</Link>
          <Link to="/schedule">Release schedule</Link>
        </nav>
        <nav aria-label="Footer community">
          <h3>Your corner</h3>
          <Link to="/community">Community</Link>
          <Link to="/rooms">Watch &amp; read together</Link>
          <Link to="/library">My library</Link>
          <Link to="/settings">Settings &amp; about</Link>
        </nav>
        <nav className="footer-genres" aria-label="Footer genres">
          <h3>Find your mood</h3>
          <div>
            {genres.map((genre) => (
              <Link key={genre} to={`/browse/all?genre=${encodeURIComponent(genre)}`}>
                {genre}
              </Link>
            ))}
          </div>
        </nav>
      </div>
      <div className="footer-fineprint">
        <span>© {new Date().getFullYear()} Yoru · Made for the stories.</span>
        <p>
          Metadata from MyAnimeList via Tenrai and Kitsu. Media belongs to its respective owners.
          Reading sources are credited in the reader; availability depends on the provider.
        </p>
      </div>
      {open && (
        <Modal title="Online watchers and readers" close={() => setOpen(false)} wide>
          <div className="presence-panel">
            <span className="presence-panel-kicker">
              <span className={`presence-signal ${connected ? 'is-live' : ''}`} /> THE YORU
              COMMUNITY
            </span>
            <h2>Here, together.</h2>
            <p>Watchers, readers, and everyone finding their next story.</p>
            <div className="presence-totals">
              {[
                ['count', 'Online now'],
                ['registered', 'Members'],
                ['guests', 'Guests'],
              ].map(([key, label]) => (
                <div key={key}>
                  <strong>{count(key)}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <div className="presence-activities">
              {activities.map(([Icon, key, label]) => (
                <span key={key}>
                  <Icon size={15} /> {count(key)} {label.toLowerCase()}
                </span>
              ))}
            </div>
            <h3>
              Members online <span>{count('registered')}</span>
            </h3>
            {!connected ? (
              <div className="presence-empty" role="status">
                Live status is temporarily unavailable. Reconnecting automatically…
              </div>
            ) : data?.users?.length ? (
              <ul className="presence-members">
                {data.users.map((member) => (
                  <li key={member.id}>
                    <Avatar user={member} />
                    <span>
                      <strong>{member.name}</strong>
                      <small>Yoru member</small>
                    </span>
                    <span className="member-online">
                      <i />
                      Online
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="presence-empty">
                <Users size={25} />
                <strong>A little quiet, a little cozy.</strong>
                <span>No signed-in members are online right now. Guests are included above.</span>
              </div>
            )}
            {connected && data?.registered > data?.users?.length && (
              <p className="presence-note">
                Showing {data.users.length} of {count('registered')} online members.
              </p>
            )}
            <p className="presence-note">
              Updated about every 25 seconds. Watching and reading count open player and reader
              pages, not verified playback. Guests stay anonymous.
            </p>
            <Link to="/community" className="footer-community-link" onClick={() => setOpen(false)}>
              Join the conversation <ArrowUpRight size={15} />
            </Link>
          </div>
        </Modal>
      )}
    </footer>
  );
}
