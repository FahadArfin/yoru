import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useLocation } from './collection-router';
import { Library, MessageCircle, Users } from 'lucide-react';
import { useApp } from './state';
import './space.css';

const SpaceControlsContext = createContext(null);
export function SpaceControls({ children, label }) {
  const target = useContext(SpaceControlsContext);
  const controls = (
    <div className="space-subtabs" role="group" aria-label={label}>
      {children}
    </div>
  );
  return target ? createPortal(controls, target) : null;
}

export default function SpaceLayout({ children }) {
  const hub = useRef(null);
  const [controlsTarget, setControlsTarget] = useState(null);
  const { pathname, search } = useLocation();
  const view = new URLSearchParams(search).get('view');
  const { visitors } = useApp();
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
  }, [pathname, view]);
  return (
    <SpaceControlsContext.Provider value={controlsTarget}>
      <div className="space-hub" ref={hub}>
        <div className="space-header space-navigation">
          <div className="space-navigation-row">
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
            {pathname.endsWith('/community') && (
              <span className="space-presence">
                <span className={`live-dot ${!visitors.connected ? 'muted-dot' : ''}`} />
                {visitors.connected ? `${visitors.data?.count || 0} online` : 'Connecting…'}
              </span>
            )}
          </div>
          <div className="space-controls-slot" ref={setControlsTarget} />
        </div>
        {children || <Outlet />}
      </div>
    </SpaceControlsContext.Provider>
  );
}
