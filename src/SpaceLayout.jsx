import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Library, MessageCircle, Users } from 'lucide-react';
import './space.css';

export default function SpaceLayout() {
  return (
    <div className="space-hub">
      <div className="space-header">
        <div>
          <span className="eyebrow">YOUR STORIES. YOUR PEOPLE.</span>
          <h1>My Space</h1>
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
