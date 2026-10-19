import { createContext, useContext } from 'react';

export const CollectionContext = createContext(null);
export const useCollection = () => useContext(CollectionContext);
export const collectionDestination = (pathname) =>
  /^\/ara-ara(?:\/|$)/.test(pathname) ? 'ara-ara' : 'yoru';
export const collectionContentAllowed = (destination, confirmed) =>
  destination !== 'ara-ara' || confirmed === true;

export function collectionPath(to, active) {
  if (
    !active ||
    typeof to !== 'string' ||
    !to.startsWith('/') ||
    to.startsWith('//') ||
    to.startsWith('/ara-ara')
  )
    return to;
  if (
    !/^\/(?:$|\?|browse(?:\/|$)|title\/|watch\/|read\/|schedule(?:\?|$)|community(?:\/|\?|$)|library(?:\?|$)|rooms(?:\/|\?|$)|settings(?:\?|$))/.test(
      to,
    )
  )
    return to;
  return `/ara-ara${to.replace(/^\/browse\//, '/').replace(/^\/(?=\?|$)/, '')}`;
}
