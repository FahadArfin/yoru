import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import AraContent from './AraContent';
import { nsfwCategories, confirmationKey } from '../nsfw';

export default function NsfwPage() {
  const { category, id } = useParams();
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

  if (category && !selected && !['schedule', 'community'].includes(category))
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
        <p className="nsfw-gate-detail">
          Mature themes, violence and strong language. This collection excludes sexually explicit
          titles. Please confirm your age before continuing.
        </p>
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
          <p>Mature stories. Darker worlds. Anime, manga and manhwa, curated for adults.</p>
        </div>
        <button className="nsfw-leave" onClick={leave}>
          <ArrowLeft size={15} /> Leave this section
        </button>
      </header>
      <AraContent key={category || id || 'discover'} category={category} id={id} />
      <p className="nsfw-session-note">
        <ShieldCheck size={14} aria-hidden="true" />
        Confirmation lasts for this tab’s session. Leave this section to reset it.
      </p>
    </section>
  );
}
