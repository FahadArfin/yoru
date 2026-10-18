import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Home,
  Compass,
  CalendarDays,
  Library,
  Play,
  BookOpen,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { Modal } from './components';
import { clearAdultConfirmation } from './nsfw';

export default function MobileNavigation({ adult = false }) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const { pathname } = useLocation();
  const base = adult ? '/ara-ara' : '';
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) setOpen(false);
    };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  if (!mobile) return null;
  const inSpace = ['/community', '/library', '/rooms'].some((path) =>
    pathname.startsWith(base + path),
  );
  const inBrowse = adult
    ? ['anime', 'manga', 'manhwa'].some((kind) => pathname === `${base}/${kind}`)
    : pathname.startsWith('/browse/');
  return (
    <>
      <nav className="mobile-navigation" aria-label="Phone navigation">
        <NavLink to={base || '/'} end>
          <Home size={20} />
          <span>Home</span>
        </NavLink>
        <button
          className={inBrowse || open ? 'active' : ''}
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <Compass size={20} />
          <span>Browse</span>
        </button>
        <NavLink to={`${base}/schedule`}>
          <CalendarDays size={20} />
          <span>Schedule</span>
        </NavLink>
        <Link
          to={`${base}/community`}
          className={inSpace ? 'active' : ''}
          aria-current={inSpace ? 'page' : undefined}
        >
          <Library size={20} />
          <span>My Space</span>
        </Link>
      </nav>
      {open && (
        <Modal title="Browse collections" close={() => setOpen(false)}>
          <div className="mobile-browse-menu">
            <span className="eyebrow">YOUR NEXT STORY</span>
            <h2>Browse collections</h2>
            <nav aria-label="Phone collections">
              {[
                ['anime', 'Anime', Play, 'Find your next episode'],
                ['manga', 'Manga', BookOpen, 'Stories, one page at a time'],
                ['manhwa', 'Manhwa', Layers, 'Webtoons worth scrolling'],
              ].map(([kind, label, Icon, caption]) => (
                <Link
                  key={kind}
                  aria-label={label}
                  to={adult ? `${base}/${kind}` : `/browse/${kind}`}
                  onClick={() => setOpen(false)}
                >
                  <Icon size={23} />
                  <span>
                    <strong>{label}</strong>
                    <small>{caption}</small>
                  </span>
                  <ArrowRight size={18} />
                </Link>
              ))}
            </nav>
            <Link
              className="mobile-collection-switch"
              to={adult ? '/' : '/ara-ara'}
              onClick={() => {
                setOpen(false);
                if (adult) clearAdultConfirmation();
              }}
            >
              {adult ? 'Back to Yoru' : 'Ara Ara · 18+'}
              <ArrowRight size={16} />
            </Link>
          </div>
        </Modal>
      )}
    </>
  );
}
