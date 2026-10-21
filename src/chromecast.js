// Google Cast's Default Media Receiver fetches this URL itself. Never cast an iframe page.
export function castMediaDescriptor(source) {
  if (!['video', 'hls'].includes(source?.kind)) return null;
  try {
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const hls = source.kind === 'hls' || /\.m3u8$/i.test(url.pathname);
    return {
      url: url.href,
      contentType: hls
        ? 'application/x-mpegURL'
        : /\.webm$/i.test(url.pathname)
          ? 'video/webm'
          : 'video/mp4',
    };
  } catch {
    return null;
  }
}

export function castErrorMessage(error) {
  const code = typeof error === 'string' ? error : error?.code;
  if (code === 'cancel') return '';
  if (code === 'receiver_unavailable' || code === 'session_error')
    return 'No Cast device connected. Check that your TV and browser are on the same Wi-Fi, then try again.';
  return 'Could not cast this source. The TV must be able to open the video directly; its format or source permissions may prevent playback. Local playback is still available.';
}

let sdkPromise;
export function loadCastSdk() {
  if (window.cast?.framework && window.chrome?.cast) return Promise.resolve(window.cast.framework);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(new Error('Cast requires HTTPS.'));
      return;
    }
    const script = document.createElement('script');
    const previous = window.__onGCastApiAvailable;
    const finish = (available) => {
      clearTimeout(timeout);
      if (window.__onGCastApiAvailable === ready) window.__onGCastApiAvailable = previous;
      if (available && window.cast?.framework) resolve(window.cast.framework);
      else {
        script.remove();
        reject(new Error('Google Cast is unavailable in this browser.'));
      }
    };
    const ready = (available) => {
      try {
        previous?.(available);
      } finally {
        finish(available);
      }
    };
    const timeout = setTimeout(() => finish(false), 12000);
    window.__onGCastApiAvailable = ready;
    script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    script.async = true;
    script.onerror = () => finish(false);
    document.head.append(script);
  }).catch((error) => {
    sdkPromise = null;
    throw error;
  });
  return sdkPromise;
}

let initializedContext;
export function getCastContext(framework) {
  const context = framework.CastContext.getInstance();
  if (initializedContext !== context) {
    context.setOptions({
      receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED,
    });
    initializedContext = context;
  }
  return context;
}
