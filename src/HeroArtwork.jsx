import React, { useEffect, useState } from 'react';
import './hero-carousel.css';

// Keep the outgoing artwork underneath the incoming frame throughout the fade.
export default function HeroArtwork({ identity, children, previous, next, dragCommit = 0 }) {
  const [frame, setFrame] = useState({ identity, children, dragCommit, previous: null });
  if (frame.identity !== identity) {
    setFrame({
      identity,
      children,
      dragCommit,
      previous:
        frame.identity && frame.dragCommit === dragCommit
          ? { identity: frame.identity, children: frame.children }
          : null,
    });
  }
  useEffect(() => {
    if (!frame.previous) return;
    const timer = setTimeout(() => setFrame((value) => ({ ...value, previous: null })), 850);
    return () => clearTimeout(timer);
  }, [frame.identity]);
  return (
    <div className="hero-art-stack" aria-hidden="true">
      {previous && <div className="hero-art-layer hero-art-neighbor previous">{previous}</div>}
      {next && <div className="hero-art-layer hero-art-neighbor next">{next}</div>}
      {frame.previous && (
        <div className="hero-art-layer outgoing" key={frame.previous.identity}>
          {frame.previous.children}
        </div>
      )}
      <div className={`hero-art-layer${frame.previous ? ' incoming' : ''}`} key={identity}>
        {children}
      </div>
    </div>
  );
}
