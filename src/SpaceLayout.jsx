import React, { useLayoutEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Library, MessageCircle, Users } from 'lucide-react';
import './space.css';

export default function SpaceLayout() {
  const hub = useRef(null);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    const page = hub.current?.querySelector('.page');
    if (!page || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = page.animate(
      [
        { opacity: 0.3, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 340, easing: 'cubic-bezier(.22,1,.36,1)' },
    );
    return () => animation.cancel();
  }, [pathname]);
  return (
    <div className="space-hub" ref={hub}>
      <div className="space-header">
        <div>
          <span className="eyebrow">YOUR STORIES. YOUR PEOPLE.</span>
          <h1>My Space</h1>
          <p>Your collection, conversations, and company.</p>
        </div>
        <nav className="space-tabs" aria-label="My Space sections">
          <NavLink to="/library">
            <Library size={17} />
            Library
          </NavLink>
          <NavLink to="/community">
            <MessageCircle size={17} />
            Community
          </NavLink>
          <NavLink to="/rooms" end>
            <Users size={17} />
            Rooms
          </NavLink>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
