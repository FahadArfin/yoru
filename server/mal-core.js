import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { apiError } from './validation.js';
export function malConfiguration(env = process.env) {
  const encoded = env.MAL_TOKEN_ENCRYPTION_KEY || '';
  const key = /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    ? Buffer.from(encoded, 'base64')
    : Buffer.alloc(0);
  const config = {
    clientId: env.MAL_CLIENT_ID || '',
    clientSecret: env.MAL_CLIENT_SECRET || '',
    redirectUri: env.MAL_REDIRECT_URI || '',
    key,
  };
  let validRedirect = false;
  try {
    const url = new URL(config.redirectUri);
    validRedirect =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch {
    /* Optional integration remains disabled. */
  }
  return {
    ...config,
    configured: Boolean(
      config.clientId && config.clientSecret && validRedirect && key.length === 32,
    ),
  };
}

export function encryptMal(value, key, ownerId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`yoru:mal:${ownerId}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}
export function decryptMal(value, key, ownerId) {
  try {
    const [version, iv, tag, content] = value.split('.');
    if (version !== 'v1') throw new Error('Unsupported encryption version');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`yoru:mal:${ownerId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(content, 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    );
  } catch {
    throw apiError(409, 'Reconnect MyAnimeList to refresh the saved connection.');
  }
}
export function tokenPayload(payload, previous = {}) {
  if (
    typeof payload.access_token !== 'string' ||
    payload.access_token.length < 8 ||
    payload.access_token.length > 30000
  )
    throw apiError(502, 'MyAnimeList returned an invalid access token.');
  const expires = Number(payload.expires_in);
  if (!Number.isFinite(expires) || expires < 1 || expires > 366 * 86400)
    throw apiError(502, 'MyAnimeList returned an invalid token expiry.');
  const refreshToken = payload.refresh_token ?? previous.refreshToken;
  if (typeof refreshToken !== 'string' || refreshToken.length < 8 || refreshToken.length > 30000)
    throw apiError(502, 'MyAnimeList returned an invalid refresh token.');
  return {
    accessToken: payload.access_token,
    refreshToken,
    expiresAt: Date.now() + expires * 1000,
  };
}
export function normalizeMalListItem(entry, kind) {
  const node = entry?.node;
  const status = entry?.list_status;
  if (
    !node ||
    !status ||
    !Number.isSafeInteger(node.id) ||
    node.id < 1 ||
    node.id > 999999999 ||
    typeof node.title !== 'string'
  )
    throw apiError(
      502,
      'MyAnimeList returned an incomplete list entry. Your library has not changed.',
    );
  const progress =
    kind === 'anime'
      ? (status.num_episodes_watched ?? status.num_watched_episodes)
      : status.num_chapters_read;
  if (!Number.isSafeInteger(progress) || progress < 0 || progress > 1000000)
    throw apiError(502, 'MyAnimeList returned invalid reading or watching progress.');
  const states = {
    watching: 'watching',
    reading: 'reading',
    completed: 'completed',
    on_hold: 'paused',
    dropped: 'dropped',
    plan_to_watch: 'planned',
    plan_to_read: 'planned',
  };
  if (!states[status.status])
    throw apiError(502, 'MyAnimeList returned an unsupported list status.');
  const score = Number(status.score);
  if (!Number.isInteger(score) || score < 0 || score > 10)
    throw apiError(502, 'MyAnimeList returned an invalid score.');
  return {
    mediaId: `mal-${kind}-${node.id}`,
    malId: node.id,
    title: node.title.slice(0, 300),
    type: kind === 'anime' ? 'ANIME' : 'MANGA',
    total: (kind === 'anime' ? node.num_episodes : node.num_chapters) || null,
    progress,
    status: states[status.status],
    score: score || null,
  };
}
