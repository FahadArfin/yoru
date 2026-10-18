import { createContext, useContext } from 'react';

export const CollectionContext = createContext(null);
export const useCollection = () => useContext(CollectionContext);

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
