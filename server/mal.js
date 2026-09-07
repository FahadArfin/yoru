import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { get, run, transaction, now } from './db.js';
import { apiError, asyncRoute, cookie, hashToken, requireAuth } from './auth.js';
import { rememberImportedMedia } from './catalog.js';

// MAL's published OAuth clients use the provider's plain PKCE challenge support.
// Both state and verifier are bound to the initiating Yoru session. OAuth secrets
// stay server-side; this integration never writes to the user's MAL account.
const AUTH_URL = 'https://myanimelist.net/v1/oauth2/authorize';
const TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';
const API_URL = 'https://api.myanimelist.net/v2';
const STATE_COOKIE = 'yoru_mal_state';
const MAX_ENTRIES = 5000;
const PAGE_SIZE = 500;
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
  sameSite: 'lax',
  path: '/',
};

export function malConfiguration() {
  const encoded = process.env.MAL_TOKEN_ENCRYPTION_KEY || '';
  const key = /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    ? Buffer.from(encoded, 'base64')
    : Buffer.alloc(0);
  const config = {
    clientId: process.env.MAL_CLIENT_ID || '',
    clientSecret: process.env.MAL_CLIENT_SECRET || '',
    redirectUri: process.env.MAL_REDIRECT_URI || '',
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
export const malEnabled = malConfiguration().configured;

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
function tokenPayload(payload, previous = {}) {
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

export function createMalRouter({
  fetchImpl = fetch,
  config = malConfiguration(),
  onLibraryChange = () => {},
  pageDelayMs = 500,
} = {}) {
  const router = Router();
  const inFlight = new Set();
  const syncLimit = rateLimit({
    windowMs: 60000,
    limit: process.env.NODE_ENV === 'test' ? 1000 : 3,
    keyGenerator: (req) => req.user.id,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Please wait a minute before pulling your list again.' },
  });
  const configured = () => {
    if (!config.configured)
      throw apiError(
        503,
        'MyAnimeList connection has not been configured by this host. XML import is available now.',
      );
  };
  async function remote(url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw apiError(
        502,
        'MyAnimeList is unavailable. Your library has not changed. Try again later.',
      );
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 400)
        throw apiError(409, 'MyAnimeList authorization expired. Reconnect your account.');
      if (response.status === 429)
        throw apiError(429, 'MyAnimeList is rate limiting requests. Wait a minute and try again.');
      throw apiError(
        502,
        'MyAnimeList could not complete the request. Your library has not changed.',
      );
    }
    try {
      return await response.json();
    } catch {
      throw apiError(502, 'MyAnimeList returned an unreadable response.');
    }
  }
  const tokenRequest = (values) =>
    remote(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...values,
      }),
    });
  const apiRequest = (path, accessToken) =>
    remote(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
  function stillOwner(req, version) {
    if (
      !get(
        'SELECT token_hash FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',
        req.sessionHash,
        req.user.id,
        Date.now(),
      )
    )
      throw apiError(401, 'Sign in again to continue.');
    if (
      version &&
      get('SELECT connection_version FROM mal_connections WHERE user_id=?', req.user.id)
        ?.connection_version !== version
    )
      throw apiError(409, 'Your MyAnimeList connection changed. No list changes were saved.');
  }
  router.get('/status', (req, res) => {
    const record =
      req.user &&
      get('SELECT username,last_synced_at FROM mal_connections WHERE user_id=?', req.user.id);
    res.json({
      configured: config.configured,
      connected: Boolean(record),
      username: record?.username || null,
      lastSyncedAt: record?.last_synced_at || null,
      mode: 'pull',
      favoritesSupported: false,
    });
  });
  router.get('/connect', requireAuth, (req, res) => {
    configured();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    run(
      'DELETE FROM mal_oauth_states WHERE expires_at<=? OR session_hash=?',
      Date.now(),
      req.sessionHash,
    );
    run(
      'INSERT INTO mal_oauth_states(state_hash,user_id,session_hash,verifier_cipher,expires_at) VALUES(?,?,?,?,?)',
      hashToken(state),
      req.user.id,
      req.sessionHash,
      encryptMal(verifier, config.key, req.user.id),
      Date.now() + 10 * 60000,
    );
    res.cookie(STATE_COOKIE, state, { ...cookieOptions, maxAge: 10 * 60000 });
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state,
      code_challenge: verifier,
      code_challenge_method: 'plain',
    }).toString();
    res.redirect(url.toString());
  });
  router.get(
    '/callback',
    requireAuth,
    asyncRoute(async (req, res) => {
      configured();
      const state =
        typeof req.query.state === 'string' && req.query.state.length < 200 ? req.query.state : '';
      const browserState = cookie(req, STATE_COOKIE);
      const record =
        state &&
        get(
          "SELECT * FROM mal_oauth_states WHERE state_hash=? AND expires_at>? AND verifier_cipher!=''",
          hashToken(state),
          Date.now(),
        );
      if (
        !record ||
        !browserState ||
        hashToken(browserState) !== hashToken(state) ||
        record.user_id !== req.user.id ||
        record.session_hash !== req.sessionHash
      )
        throw apiError(
          400,
          'MyAnimeList connection expired or your session changed. Start again from Settings.',
        );
      res.clearCookie(STATE_COOKIE, cookieOptions);
      if (req.query.error) {
        run('DELETE FROM mal_oauth_states WHERE state_hash=?', hashToken(state));
        return res.redirect('/settings?mal=cancelled');
      }
      if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 20000)
        throw apiError(400, 'MyAnimeList did not return an authorization code.');
      const verifier = decryptMal(record.verifier_cipher, config.key, req.user.id);
      // Clearing the verifier consumes the callback, while retaining a cancellation
      // marker so Disconnect can stop an authorization already exchanging tokens.
      run("UPDATE mal_oauth_states SET verifier_cipher='' WHERE state_hash=?", hashToken(state));
      const tokens = tokenPayload(
        await tokenRequest({
          grant_type: 'authorization_code',
          code: req.query.code,
          redirect_uri: config.redirectUri,
          code_verifier: verifier,
        }),
      );
      const profile = await apiRequest('/users/@me', tokens.accessToken);
      if (
        !Number.isSafeInteger(profile.id) ||
        profile.id < 1 ||
        typeof profile.name !== 'string' ||
        !profile.name.trim()
      )
        throw apiError(502, 'MyAnimeList returned an invalid profile.');
      stillOwner(req);
      if (
        !get(
          "SELECT state_hash FROM mal_oauth_states WHERE state_hash=? AND session_hash=? AND verifier_cipher=''",
          hashToken(state),
          req.sessionHash,
        )
      )
        throw apiError(409, 'MyAnimeList connection was cancelled.');
      run(
        'INSERT INTO mal_connections(user_id,mal_user_id,username,tokens_cipher,connection_version,connected_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET mal_user_id=excluded.mal_user_id,username=excluded.username,tokens_cipher=excluded.tokens_cipher,connection_version=excluded.connection_version,connected_at=excluded.connected_at,last_synced_at=NULL',
        req.user.id,
        String(profile.id),
        profile.name.slice(0, 100),
        encryptMal(tokens, config.key, req.user.id),
        randomUUID(),
        now(),
      );
      run('DELETE FROM mal_oauth_states WHERE state_hash=?', hashToken(state));
      res.redirect('/settings?mal=connected');
    }),
  );
  router.post('/disconnect', requireAuth, (req, res) => {
    run('DELETE FROM mal_connections WHERE user_id=?', req.user.id);
    run('DELETE FROM mal_oauth_states WHERE user_id=?', req.user.id);
    res.clearCookie(STATE_COOKIE, cookieOptions);
    res.json({
      connected: false,
      message: 'MyAnimeList disconnected. Your Yoru library is unchanged.',
    });
  });
  router.post(
    '/sync',
    requireAuth,
    syncLimit,
    asyncRoute(async (req, res) => {
      configured();
      if (inFlight.has(req.user.id))
        throw apiError(409, 'Your MyAnimeList library is already being pulled.');
      const connection = get('SELECT * FROM mal_connections WHERE user_id=?', req.user.id);
      if (!connection) throw apiError(409, 'Connect MyAnimeList before pulling your list.');
      inFlight.add(req.user.id);
      try {
        let tokens = decryptMal(connection.tokens_cipher, config.key, req.user.id);
        if (tokens.expiresAt < Date.now() + 60000) {
          tokens = tokenPayload(
            await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }),
            tokens,
          );
          stillOwner(req, connection.connection_version);
          run(
            'UPDATE mal_connections SET tokens_cipher=? WHERE user_id=? AND connection_version=?',
            encryptMal(tokens, config.key, req.user.id),
            req.user.id,
            connection.connection_version,
          );
        }
        const collected = new Map();
        let requests = 0;
        for (const kind of ['anime', 'manga']) {
          let offset = 0;
          for (let page = 0; page < 11; page++) {
            if (requests++ && pageDelayMs)
              await new Promise((done) => setTimeout(done, pageDelayMs));
            stillOwner(req, connection.connection_version);
            const params = new URLSearchParams({
              fields: `list_status,${kind === 'anime' ? 'num_episodes' : 'num_chapters'}`,
              limit: String(PAGE_SIZE),
              offset: String(offset),
              nsfw: 'true',
            });
            // Always construct the destination ourselves; never follow provider-supplied paging URLs.
            const payload = await apiRequest(
              `/users/@me/${kind}list?${params}`,
              tokens.accessToken,
            );
            if (!Array.isArray(payload.data) || payload.data.length > PAGE_SIZE)
              throw apiError(502, 'MyAnimeList returned an invalid list page.');
            for (const entry of payload.data) {
              const normalized = normalizeMalListItem(entry, kind);
              if (collected.has(normalized.mediaId))
                throw apiError(502, 'MyAnimeList repeated a page. Your library has not changed.');
              collected.set(normalized.mediaId, normalized);
            }
            if (collected.size > MAX_ENTRIES)
              throw apiError(
                413,
                `Pull up to ${MAX_ENTRIES} titles at a time. Use a smaller XML export for a larger account.`,
              );
            if (!payload.paging?.next) break;
            if (!payload.data.length || page === 10)
              throw apiError(
                502,
                'MyAnimeList pagination did not finish. No list changes were saved.',
              );
            offset += payload.data.length;
          }
        }
        stillOwner(req, connection.connection_version);
        const timestamp = now();
        const entries = [...collected.values()];
        transaction(() => {
          for (const entry of entries)
            run(
              'INSERT INTO library(user_id,media_id,favorite,status,progress,score,updated_at) VALUES(?,?,0,?,?,?,?) ON CONFLICT(user_id,media_id) DO UPDATE SET status=excluded.status,progress=excluded.progress,score=excluded.score,updated_at=excluded.updated_at',
              req.user.id,
              entry.mediaId,
              entry.status,
              entry.progress,
              entry.score,
              timestamp,
            );
          run(
            'UPDATE mal_connections SET last_synced_at=? WHERE user_id=?',
            timestamp,
            req.user.id,
          );
        });
        rememberImportedMedia(entries);
        onLibraryChange(req.user.id);
        res.json({
          imported: entries.length,
          anime: entries.filter((entry) => entry.type === 'ANIME').length,
          manga: entries.filter((entry) => entry.type === 'MANGA').length,
          lastSyncedAt: timestamp,
          message: `${entries.length} titles pulled from MyAnimeList. Your Yoru favorites were preserved.`,
        });
      } finally {
        inFlight.delete(req.user.id);
      }
    }),
  );
  return router;
}
