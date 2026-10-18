import { useSyncExternalStore } from 'react';

function applyTheme(value) {
  const theme = value === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f6f3ea' : '#181c26');
}

function subscribe(callback) {
  const storage = (event) => {
    if (event.key !== 'yoru:theme' && event.key !== null) return;
    applyTheme(event.newValue);
    callback();
  };
  window.addEventListener('storage', storage);
  window.addEventListener('yoru:theme-change', callback);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener('yoru:theme-change', callback);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
    () => 'dark',
  );
  return [
    theme,
    (next) => {
      applyTheme(next);
      try {
        localStorage.setItem('yoru:theme', next === 'light' ? 'light' : 'dark');
      } catch {}
      window.dispatchEvent(new Event('yoru:theme-change'));
    },
  ];
}
