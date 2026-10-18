// Run before the app paints so a saved light theme never flashes dark.
(() => {
  let theme = 'dark';
  try {
    if (localStorage.getItem('yoru:theme') === 'light') theme = 'light';
  } catch {}
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f6f3ea' : '#181c26');
})();
