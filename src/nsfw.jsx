import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, ChevronDown, Layers, MonitorPlay } from 'lucide-react';

export const nsfwCategories = [
  { id: 'anime', label: 'Hentai anime', format: 'Animation', Icon: MonitorPlay },
  { id: 'manga', label: 'Hentai manga', format: 'Manga', Icon: BookOpen },
  { id: 'manhwa', label: 'Adult manhwa', format: 'Manhwa', Icon: Layers },
];

export function NsfwMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);
  const focusFirst = () => {
    setOpen(true);
    requestAnimationFrame(() => root.current?.querySelector('a')?.focus());
  };
  return (
    <div
      className="nsfw-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className={`nsfw-menu-trigger${location.pathname.startsWith('/nsfw') ? ' active' : ''}`}
        aria-label="NSFW menu"
        aria-expanded={open}
        aria-controls="nsfw-menu-links"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusFirst();
          }
        }}
      >
        NSFW <span>18+</span> <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <nav className="nsfw-dropdown" id="nsfw-menu-links" aria-label="NSFW categories">
          <small>ADULT COLLECTIONS</small>
          {nsfwCategories.map(({ id, label, Icon }) => (
            <Link key={id} to={`/nsfw/${id}`} onClick={() => setOpen(false)}>
              <Icon size={17} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
