import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Library, LockKeyhole, ShieldCheck } from 'lucide-react';
import { nsfwCategories, confirmationKey } from '../nsfw';

export default function NsfwPage() {
  const { category } = useParams();
  const navigate = useNavigate();
  const heading = useRef(null);
  const [confirmed, setConfirmed] = useState(() => {
    try {
      return sessionStorage.getItem(confirmationKey) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (confirmed) heading.current?.focus();
  }, [confirmed]);
  const selected = nsfwCategories.find((item) => item.id === category);
  const confirm = () => {
    try {
      sessionStorage.setItem(confirmationKey, '1');
    } catch {}
    setConfirmed(true);
  };
  const leave = () => {
    try {
      sessionStorage.removeItem(confirmationKey);
    } catch {}
    setConfirmed(false);
    navigate('/');
  };

  if (category && !selected)
    return (
      <section className="nsfw-page nsfw-gate">
        <h1>Collection not found</h1>
        <Link className="btn btn-primary" to="/ara-ara">
          Back to collections
        </Link>
      </section>
    );

  if (!confirmed)
    return (
      <section className="nsfw-page nsfw-gate" aria-labelledby="nsfw-gate-title">
        <span className="nsfw-gate-symbol" aria-hidden="true">
          <LockKeyhole size={29} />
        </span>
        <span className="nsfw-eyebrow">ARA ARA · 18+</span>
        <h1 id="nsfw-gate-title">Adults only</h1>
        <p>Welcome to Ara Ara, the separate Yoru space for visitors aged 18 or older.</p>
        <p className="nsfw-gate-detail">Please confirm your age before continuing.</p>
        <div className="nsfw-gate-actions">
          <button className="btn btn-primary" onClick={confirm}>
            I’m 18 or older <ArrowUpRight size={16} />
          </button>
          <Link className="btn btn-ghost" to="/">
            Back to Yoru
          </Link>
        </div>
      </section>
    );

  return (
    <section className="nsfw-page" aria-labelledby="nsfw-title">
      <header className="nsfw-page-heading">
        <div>
          <span className="nsfw-eyebrow">A separate space · 18+</span>
          <h1 id="nsfw-title" ref={heading} tabIndex={-1}>
            Ara Ara
          </h1>
          <p>Anime, manga and manhwa. A separate space for adults.</p>
        </div>
        <button className="nsfw-leave" onClick={leave}>
          <ArrowLeft size={15} /> Leave this section
        </button>
      </header>
      <nav className="nsfw-collections" aria-label="Choose a collection">
        {nsfwCategories.map(({ id, label, format, Icon }) => (
          <Link
            key={id}
            to={`/ara-ara/${id}`}
            className={`nsfw-collection${category === id ? ' selected' : ''}`}
            aria-current={category === id ? 'page' : undefined}
            aria-label={label}
          >
            <span className="nsfw-collection-top">
              <Icon size={27} aria-hidden="true" />
              <span className="nsfw-age-label">18+</span>
            </span>
            <span className="nsfw-collection-format">{format}</span>
            <strong>{label}</strong>
            <ArrowUpRight className="nsfw-collection-arrow" size={20} aria-hidden="true" />
          </Link>
        ))}
      </nav>
      <div className="nsfw-catalog-state">
        <span className="nsfw-catalog-icon" aria-hidden="true">
          {selected ? <selected.Icon size={25} /> : <Library size={25} />}
        </span>
        <span className="nsfw-status" role="status">
          Catalog not connected
        </span>
        <h2>{selected?.label || 'Your collections start here'}</h2>
        <p>No titles are available in {selected ? 'this collection' : 'these collections'} yet.</p>
        <Link to="/browse/anime">
          Explore the main catalog <ArrowUpRight size={14} />
        </Link>
      </div>
      <p className="nsfw-session-note">
        <ShieldCheck size={14} aria-hidden="true" />
        Confirmation lasts for this tab’s session. Leave this section to reset it.
      </p>
    </section>
  );
}
