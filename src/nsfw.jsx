import { Link, NavLink, Navigate, useParams } from 'react-router-dom';
import { BookOpen, Layers, MonitorPlay } from 'lucide-react';

export const nsfwCategories = [
  { id: 'anime', label: 'Adult anime', format: 'Anime', Icon: MonitorPlay },
  { id: 'manga', label: 'Adult manga', format: 'Manga', Icon: BookOpen },
  { id: 'manhwa', label: 'Adult manhwa', format: 'Manhwa', Icon: Layers },
];
export const confirmationKey = 'yoru:nsfw:confirmed';
export function clearAdultConfirmation() {
  try {
    sessionStorage.removeItem(confirmationKey);
  } catch {}
}
export function NsfwButton() {
  return (
    <Link className="nsfw-menu-trigger" to="/ara-ara" aria-label="NSFW · Ara Ara, 18+">
      NSFW <span>18+</span>
    </Link>
  );
}
export function AraAraBrand() {
  return (
    <Link to="/ara-ara" className="brand ara-brand" aria-label="Ara Ara home">
      <span>
        ara ara<span className="brand-dot">.</span>
      </span>
      <small>18+</small>
    </Link>
  );
}
export function AraAraNavigation() {
  return (
    <nav className="home-topnav" aria-label="Explore Ara Ara">
      <NavLink to="/ara-ara" end>
        Discover
      </NavLink>
      {nsfwCategories.map(({ id, format }) => (
        <NavLink key={id} to={`/ara-ara/${id}`}>
          {format}
        </NavLink>
      ))}
      <Link to="/" className="nsfw-menu-trigger" onClick={clearAdultConfirmation}>
        Back to Yoru
      </Link>
    </nav>
  );
}
export function AraAraFooter() {
  return (
    <footer className="ara-footer" aria-label="Ara Ara footer">
      <div>
        <AraAraBrand />
        <p>Yoru’s separate space for adults. 18+ only.</p>
      </div>
      <nav aria-label="Ara Ara collections">
        {nsfwCategories.map(({ id, format }) => (
          <Link key={id} to={`/ara-ara/${id}`}>
            {format}
          </Link>
        ))}
      </nav>
      <Link to="/" onClick={clearAdultConfirmation}>
        Return to Yoru
      </Link>
    </footer>
  );
}
export function LegacyNsfwRedirect() {
  const { category } = useParams();
  return <Navigate replace to={`/ara-ara${category ? `/${category}` : ''}`} />;
}
