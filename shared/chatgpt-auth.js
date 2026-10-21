// Dispatch owns the sign-in/out endpoints. Only same-origin return paths are allowed.
export function authReturnPath(value, fallback = '/') {
  if (
    typeof value !== 'string' ||
    value.length > 2000 ||
    !value.startsWith('/') ||
    value.startsWith('//')
  )
    return fallback;
  try {
    const url = new URL(value, 'https://yoru.local');
    if (
      url.origin !== 'https://yoru.local' ||
      /^\/(?:signin-with-chatgpt|signout-with-chatgpt|callback|api)(?:\/|$)/.test(url.pathname)
    )
      return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
export const chatgptSignOutPath = (returnTo = '/') =>
  `/signout-with-chatgpt?return_to=${encodeURIComponent(authReturnPath(returnTo))}`;
