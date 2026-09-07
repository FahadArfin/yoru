import { randomBytes, randomUUID } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  malConfiguration,
  encryptMal,
  decryptMal,
  normalizeMalListItem,
  tokenPayload,
} from '../server/mal-core.js';
import { rememberImportedMedia } from '../server/catalog-core.js';
import { apiError } from '../server/validation.js';
import {
  requireAuth,
  rateLimit,
  cookieOptions,
  hashToken,
  randomToken,
  remoteJson,
} from './security.js';
import { now, liveSession, sessionValues, changes } from './store.js';
import { importStatement, metadataStatement } from './imports.js';

const configured = (c) => {
  const config = malConfiguration(c.env);
  if (!config.configured)
    throw apiError(
      503,
      'MyAnimeList connection has not been configured by this host. XML import is available now.',
    );
  return config;
};
const tokenRequest = (config, values) =>
  remoteJson('https://myanimelist.net/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...values,
    }),
  });
const apiRequest = (path, token) =>
  remoteJson(`https://api.myanimelist.net/v2${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
export function malRoutes(app) {
  app.get('/api/mal/status', async (c) => {
    const record = c.get('user')
      ? await c
          .get('db')
          .get(
            'SELECT username,last_synced_at FROM mal_connections WHERE user_id=?',
            c.get('user').id,
          )
      : null;
    return c.json({
      configured: malConfiguration(c.env).configured,
      connected: Boolean(record),
      username: record?.username || null,
      lastSyncedAt: record?.last_synced_at || null,
      mode: 'pull',
      favoritesSupported: false,
    });
  });
  app.get('/api/mal/connect', requireAuth, async (c) => {
    const config = configured(c),
      db = c.get('db'),
      state = randomToken(),
      verifier = randomBytes(48).toString('base64url');
    await db.batch([
      db.statement(
        'DELETE FROM mal_oauth_states WHERE expires_at<=? OR session_hash=?',
        Date.now(),
        c.get('sessionHash'),
      ),
      db.statement(
        'INSERT INTO mal_oauth_states(state_hash,user_id,session_hash,verifier_cipher,expires_at) VALUES(?,?,?,?,?)',
        hashToken(state),
        c.get('user').id,
        c.get('sessionHash'),
        encryptMal(verifier, config.key, c.get('user').id),
        Date.now() + 600000,
      ),
    ]);
    setCookie(c, 'yoru_mal_state', state, { ...cookieOptions(c), maxAge: 600 });
    return c.redirect(
      'https://myanimelist.net/v1/oauth2/authorize?' +
        new URLSearchParams({
          response_type: 'code',
          client_id: config.clientId,
          redirect_uri: config.redirectUri,
          state,
          code_challenge: verifier,
          code_challenge_method: 'plain',
        }),
    );
  });
  app.get('/api/mal/callback', requireAuth, async (c) => {
    const config = configured(c),
      db = c.get('db'),
      userId = c.get('user').id,
      state = c.req.query('state') || '',
      browserState = getCookie(c, 'yoru_mal_state');
    if (
      !state ||
      state.length > 200 ||
      !browserState ||
      hashToken(browserState) !== hashToken(state)
    )
      throw apiError(
        400,
        'MyAnimeList connection expired or your session changed. Start again from Settings.',
      );
    const claim = randomUUID(),
      stateHash = hashToken(state);
    const record = await db.get(
      `UPDATE mal_oauth_states SET claim=? WHERE state_hash=? AND user_id=? AND session_hash=? AND expires_at>? AND claim IS NULL AND ${liveSession} RETURNING *`,
      claim,
      stateHash,
      userId,
      c.get('sessionHash'),
      Date.now(),
      ...sessionValues(c),
    );
    if (!record)
      throw apiError(
        400,
        'MyAnimeList connection expired or your session changed. Start again from Settings.',
      );
    deleteCookie(c, 'yoru_mal_state', cookieOptions(c));
    if (c.req.query('error')) {
      await db.run('DELETE FROM mal_oauth_states WHERE state_hash=? AND claim=?', stateHash, claim);
      return c.redirect('/settings?mal=cancelled');
    }
    const code = c.req.query('code');
    if (!code || code.length > 20000)
      throw apiError(400, 'MyAnimeList did not return an authorization code.');
    const verifier = decryptMal(record.verifier_cipher, config.key, userId);
    const tokens = tokenPayload(
      await tokenRequest(config, {
        grant_type: 'authorization_code',
        code,
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
    // The state marker remains during network calls so Disconnect cancels an in-flight callback.
    const result = await db.batch([
      db.statement(
        `INSERT INTO mal_connections(user_id,mal_user_id,username,tokens_cipher,connection_version,connected_at)
        SELECT ?,?,?,?,?,? WHERE ${liveSession} AND EXISTS(SELECT 1 FROM mal_oauth_states WHERE state_hash=? AND claim=? AND expires_at>?)
        ON CONFLICT(user_id) DO UPDATE SET mal_user_id=excluded.mal_user_id,username=excluded.username,tokens_cipher=excluded.tokens_cipher,connection_version=excluded.connection_version,connected_at=excluded.connected_at,last_synced_at=NULL,sync_claim=NULL,sync_expires_at=NULL`,
        userId,
        String(profile.id),
        profile.name.slice(0, 100),
        encryptMal(tokens, config.key, userId),
        randomUUID(),
        now(),
        ...sessionValues(c),
        stateHash,
        claim,
        Date.now(),
      ),
      db.statement('DELETE FROM mal_oauth_states WHERE state_hash=? AND claim=?', stateHash, claim),
    ]);
    if (!changes(result[0]))
      throw apiError(409, 'MyAnimeList connection was cancelled or your session changed.');
    return c.redirect('/settings?mal=connected');
  });
  app.post('/api/mal/disconnect', requireAuth, async (c) => {
    const db = c.get('db'),
      userId = c.get('user').id;
    await db.batch([
      db.statement('DELETE FROM mal_connections WHERE user_id=?', userId),
      db.statement('DELETE FROM mal_oauth_states WHERE user_id=?', userId),
    ]);
    deleteCookie(c, 'yoru_mal_state', cookieOptions(c));
    return c.json({
      connected: false,
      message: 'MyAnimeList disconnected. Your Yoru library is unchanged.',
    });
  });
  app.post('/api/mal/sync', requireAuth, async (c) => {
    const config = configured(c),
      db = c.get('db'),
      userId = c.get('user').id,
      claim = randomUUID();
    await rateLimit(c, 'mal', 3);
    const connection = await db.get(
      `UPDATE mal_connections SET sync_claim=?,sync_expires_at=? WHERE user_id=? AND (sync_claim IS NULL OR sync_expires_at<=?) AND ${liveSession} RETURNING *`,
      claim,
      Date.now() + 10 * 60000,
      userId,
      Date.now(),
      ...sessionValues(c),
    );
    if (!connection)
      throw apiError(
        409,
        'Connect MyAnimeList first, or wait for your current list pull to finish.',
      );
    const ownerCondition = `${liveSession} AND EXISTS(SELECT 1 FROM mal_connections WHERE user_id=? AND connection_version=? AND sync_claim=? AND sync_expires_at>?)`;
    const ownerValues = () => [
      ...sessionValues(c),
      userId,
      connection.connection_version,
      claim,
      Date.now(),
    ];
    try {
      let tokens = decryptMal(connection.tokens_cipher, config.key, userId);
      if (tokens.expiresAt < Date.now() + 60000) {
        tokens = tokenPayload(
          await tokenRequest(config, {
            grant_type: 'refresh_token',
            refresh_token: tokens.refreshToken,
          }),
          tokens,
        );
        const updated = await db.run(
          `UPDATE mal_connections SET tokens_cipher=? WHERE user_id=? AND ${ownerCondition}`,
          encryptMal(tokens, config.key, userId),
          userId,
          ...ownerValues(),
        );
        if (!changes(updated))
          throw apiError(409, 'Your MyAnimeList connection changed. No list changes were saved.');
      }
      const collected = new Map();
      let requests = 0;
      for (const kind of ['anime', 'manga']) {
        let offset = 0;
        for (let page = 0; page < 11; page++) {
          if (requests++) await new Promise((done) => setTimeout(done, 500));
          // Checking once per provider page also bounds cancellation latency.
          if (!(await db.get(`SELECT 1 WHERE ${ownerCondition}`, ...ownerValues())))
            throw apiError(409, 'Your MyAnimeList connection changed. No list changes were saved.');
          const params = new URLSearchParams({
            fields: `list_status,${kind === 'anime' ? 'num_episodes' : 'num_chapters'}`,
            limit: '500',
            offset: String(offset),
            nsfw: 'true',
          });
          const payload = await apiRequest(`/users/@me/${kind}list?${params}`, tokens.accessToken);
          if (!Array.isArray(payload.data) || payload.data.length > 500)
            throw apiError(502, 'MyAnimeList returned an invalid list page.');
          for (const entry of payload.data) {
            const normalized = normalizeMalListItem(entry, kind);
            if (collected.has(normalized.mediaId))
              throw apiError(502, 'MyAnimeList repeated a page. Your library has not changed.');
            collected.set(normalized.mediaId, normalized);
          }
          if (collected.size > 5000)
            throw apiError(
              413,
              'Pull up to 5000 titles at a time. Use a smaller XML export for a larger account.',
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
      const entries = [...collected.values()],
        timestamp = now();
      const result = await db.batch([
        importStatement(db, userId, entries, ownerCondition, ownerValues(), 'mal'),
        metadataStatement(db, entries, ownerCondition, ownerValues()),
        db.statement(
          `INSERT INTO event_log(event,payload,user_id,created_at) SELECT 'library',?,?,? WHERE ${ownerCondition}`,
          JSON.stringify({ userId }),
          userId,
          Date.now(),
          ...ownerValues(),
        ),
        db.statement(
          `UPDATE mal_connections SET last_synced_at=?,sync_claim=NULL,sync_expires_at=NULL WHERE user_id=? AND ${ownerCondition}`,
          timestamp,
          userId,
          ...ownerValues(),
        ),
      ]);
      if (!changes(result[3]))
        throw apiError(409, 'Your MyAnimeList connection changed. No list changes were saved.');
      rememberImportedMedia(entries);
      return c.json({
        imported: entries.length,
        anime: entries.filter((x) => x.type === 'ANIME').length,
        manga: entries.filter((x) => x.type === 'MANGA').length,
        lastSyncedAt: timestamp,
        message: `${entries.length} titles pulled from MyAnimeList. Your Yoru favorites were preserved.`,
      });
    } finally {
      await db.run(
        'UPDATE mal_connections SET sync_claim=NULL,sync_expires_at=NULL WHERE user_id=? AND sync_claim=?',
        userId,
        claim,
      );
    }
  });
}
