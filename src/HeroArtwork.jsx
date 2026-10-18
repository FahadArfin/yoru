import React, { useEffect, useState } from 'react';
import './hero-carousel.css';

// Keep the outgoing artwork underneath the incoming frame throughout the fade.
export default function HeroArtwork({ identity, children, offset = 0 }) {
  const [frame, setFrame] = useState({ identity, children, previous: null });
  if (frame.identity !== identity) {
    setFrame({
      identity,
      children,
      previous: frame.identity ? { identity: frame.identity, children: frame.children } : null,
    });
  }
  useEffect(() => {
    if (!frame.previous) return;
    const timer = setTimeout(() => setFrame((value) => ({ ...value, previous: null })), 850);
    return () => clearTimeout(timer);
  }, [frame.identity]);
  return (
    <div className="hero-art-stack" style={{ '--hero-drag': `${offset}px` }} aria-hidden="true">
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
