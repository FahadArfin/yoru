import React, { forwardRef, useCallback } from 'react';
import {
  Link as RouterLink,
  NavLink as RouterNavLink,
  Navigate as RouterNavigate,
  useNavigate as useRouterNavigate,
} from 'react-router-dom';
import { collectionPath, useCollection } from './collection-context';
export * from 'react-router-dom';

export const Link = forwardRef(function Link({ to, ...props }, ref) {
  const scope = useCollection();
  return <RouterLink ref={ref} to={collectionPath(to, scope?.active)} {...props} />;
});
export const NavLink = forwardRef(function NavLink({ to, ...props }, ref) {
  const scope = useCollection();
  return <RouterNavLink ref={ref} to={collectionPath(to, scope?.active)} {...props} />;
});
export function Navigate({ to, ...props }) {
  const scope = useCollection();
  return <RouterNavigate to={collectionPath(to, scope?.active)} {...props} />;
}
export function useNavigate() {
  const navigate = useRouterNavigate();
  const active = useCollection()?.active;
  return useCallback(
    (to, options) => navigate(collectionPath(to, active), options),
    [navigate, active],
  );
}
