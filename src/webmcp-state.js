import { useSyncExternalStore } from 'react';
const listeners = new Set();
let status = { supported: false, pending: false, registered: 0, failed: 0 };
let page = null;
export function setWebMCPStatus(value) {
  status = value;
  for (const listener of listeners) listener();
}
export function useWebMCPStatus() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}
export function setWatchPage(value) {
  page = value;
}
export function getWatchPage() {
  return page?.path === window.location.pathname ? page : null;
}
