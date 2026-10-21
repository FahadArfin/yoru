const RETRY_KEY = 'yoru:asset-reload:v1';
const RETRY_WINDOW_MS = 5 * 60 * 1000;

export function isAssetLoadError(error) {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS for/i.test(
    typeof error?.message === 'string' ? error.message : '',
  );
}

// A tab opened before a deployment can still reference removed, hashed chunks.
// Keep the target URL and allow one refresh, with a guard that survives refreshes.
export function recoverAssetLoad(error, browser = window, now = Date.now()) {
  if (!isAssetLoadError(error) || browser.navigator.onLine === false) return false;
  try {
    const previous = browser.sessionStorage.getItem(RETRY_KEY);
    if (
      previous !== null &&
      Number.isFinite(Number(previous)) &&
      now - Number(previous) < RETRY_WINDOW_MS
    )
      return false;
    browser.sessionStorage.setItem(RETRY_KEY, String(now));
    // If storage is unavailable or silently discards writes, do not risk a loop.
    if (browser.sessionStorage.getItem(RETRY_KEY) !== String(now)) return false;
    browser.location.reload();
    return true;
  } catch {
    return false;
  }
}
