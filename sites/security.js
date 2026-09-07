import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { apiError, text } from '../server/validation.js';
import { changes, liveSession, sessionValues, now } from './store.js';

const scrypt = promisify(scryptCallback);
export const hashToken = (value) => createHash('sha256').update(String(value)).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export const publicUser = (user) =>
  user
    ? { id: user.id, name: user.name, avatar: user.avatar || '', createdAt: user.created_at }
    : null;
export const ownUser = (user) =>
  user
    ? { ...publicUser(user), email: user.email || '', discordConnected: Boolean(user.discord_id) }
    : null;
export const cookieOptions = (c) => ({
  httpOnly: true,
  secure: new URL(c.req.url).protocol === 'https:',
  sameSite: 'Lax',
  path: '/',
});
export const discordEnabled = (env) =>
  Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_REDIRECT_URI);
export async function sessionMiddleware(c, next) {
  const token = getCookie(c, 'yoru_session');
  c.set('sessionHash', '');
  if (token && token.length <= 128) {
    const hash = hashToken(token);
    const user = await c
      .get('db')
      .get(
        'SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?',
        hash,
        Date.now(),
      );
    if (user) {
      c.set('user', user);
      c.set('sessionHash', hash);
    }
  }
  await next();
}
export async function requireAuth(c, next) {
  if (!c.get('user')) throw apiError(401, 'Sign in to continue.');
  c.set('db', c.get('db').guard(c.get('sessionHash'), c.get('user').id));
  await next();
}
export async function rateLimit(c, scope, limit, windowMs = 60000) {
  if (c.env.YORU_TEST_MODE === '1') return;
  const subject =
    scope === 'auth' || !c.get('user')
      ? c.req.header('cf-connecting-ip') || 'local'
      : c.get('user').id;
  const timestamp = Date.now();
  const key = hashToken(`${scope}:${subject}`);
  const row = await c.get('db').get(
    `INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<=? THEN 1 ELSE rate_limits.count+1 END,
    expires_at=CASE WHEN rate_limits.expires_at<=? THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING count`,
    key,
    timestamp + windowMs,
    timestamp,
    timestamp,
  );
  if (row.count > limit)
    throw apiError(429, 'Too many requests. Please wait a moment and try again.');
}
export async function originGuard(c, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    let valid = false;
    try {
      const origin = new URL(c.req.header('origin')).origin;
      const configured = (c.env.APP_ORIGIN || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      valid = configured.length
        ? configured.includes(origin)
        : origin === new URL(c.req.url).origin;
    } catch {}
    if (!valid) throw apiError(403, 'This request must come from the Yoru application.');
  }
  await next();
}
async function issueSession(c, userId) {
  const token = randomToken();
  await c
    .get('db')
    .run(
      'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
      hashToken(token),
      userId,
      Date.now() + 30 * 86400000,
      Date.now(),
    );
  setCookie(c, 'yoru_session', token, { ...cookieOptions(c), maxAge: 30 * 86400 });
}
async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}
async function passwordMatches(password, stored) {
  const [, salt, expected] = (stored || 'scrypt:' + '0'.repeat(32) + ':' + '0'.repeat(128)).split(
    ':',
  );
  if (!salt || !expected) return false;
  const derived = await scrypt(password, salt, 64),
    bytes = Buffer.from(expected, 'hex');
  return bytes.length === derived.length && timingSafeEqual(bytes, derived);
}
export async function remoteJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw apiError(502, 'The provider is temporarily unavailable. Please try again.');
  }
  if (!response.ok)
    throw apiError(
      response.status === 429 ? 429 : response.status === 404 ? 404 : 502,
      'The provider could not complete this request. Please try again.',
    );
  try {
    return await response.json();
  } catch {
    throw apiError(502, 'The provider returned an unreadable response.');
  }
}
export function authRoutes(app, { onLogout = async () => {} } = {}) {
  app.get('/api/auth/me', (c) => c.json({ user: ownUser(c.get('user')) }));
  app.post('/api/auth/register', async (c) => {
    await rateLimit(c, 'auth', 30, 15 * 60000);
    const input = await c.req.json(),
      db = c.get('db');
    const name = text(input.name, { name: 'Display name', min: 2, max: 40 });
    const email = text(input.email, { name: 'Email', min: 3, max: 254 }).toLowerCase();
    const password = text(input.password, { name: 'Password', min: 10, max: 128 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw apiError(400, 'Enter a valid email address.');
    if (await db.get('SELECT id FROM users WHERE email=?', email))
      throw apiError(409, 'An account already exists for this email. Sign in instead.');
    const hashed = await passwordHash(password),
      id = randomUUID();
    try {
      await db.run(
        'INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)',
        id,
        name,
        email,
        hashed,
        now(),
      );
    } catch (error) {
      if (String(error.message).includes('UNIQUE'))
        throw apiError(409, 'An account already exists for this email. Sign in instead.');
      throw error;
    }
    await issueSession(c, id);
    return c.json({ user: ownUser(await db.get('SELECT * FROM users WHERE id=?', id)) }, 201);
  });
  app.post('/api/auth/login', async (c) => {
    await rateLimit(c, 'auth', 30, 15 * 60000);
    const input = await c.req.json();
    const email = text(input.email, { name: 'Email', min: 3, max: 254 }).toLowerCase();
    const password = text(input.password, { name: 'Password', min: 1, max: 128 });
    const user = await c.get('db').get('SELECT * FROM users WHERE email=?', email);
    if (!(await passwordMatches(password, user?.password_hash)) || !user?.password_hash)
      throw apiError(401, 'Email or password is incorrect.');
    await issueSession(c, user.id);
    return c.json({ user: ownUser(user) });
  });
  app.post('/api/auth/logout', async (c) => {
    if (c.get('sessionHash'))
      await c.get('db').run('DELETE FROM sessions WHERE token_hash=?', c.get('sessionHash'));
    await onLogout(c.get('db'));
    deleteCookie(c, 'yoru_session', cookieOptions(c));
    return c.json({ user: null });
  });
  app.get('/api/auth/discord', async (c) => {
    if (!discordEnabled(c.env))
      throw apiError(503, 'Discord sign-in has not been configured by the host.');
    await rateLimit(c, 'auth', 30, 15 * 60000);
    const state = randomToken();
    await c
      .get('db')
      .run(
        'INSERT INTO oauth_states(state_hash,expires_at,user_id,session_hash) VALUES(?,?,?,?)',
        hashToken(state),
        Date.now() + 600000,
        c.get('user')?.id || null,
        c.get('sessionHash') || null,
      );
    setCookie(c, 'yoru_discord_state', state, { ...cookieOptions(c), maxAge: 600 });
    return c.redirect(
      'https://discord.com/oauth2/authorize?' +
        new URLSearchParams({
          client_id: c.env.DISCORD_CLIENT_ID,
          redirect_uri: c.env.DISCORD_REDIRECT_URI,
          response_type: 'code',
          scope: 'identify email',
          state,
        }),
    );
  });
  app.get('/api/auth/discord/callback', async (c) => {
    if (!discordEnabled(c.env)) throw apiError(503, 'Discord sign-in is unavailable.');
    const state = c.req.query('state') || '',
      expected = getCookie(c, 'yoru_discord_state');
    if (
      !state ||
      state.length > 200 ||
      !expected ||
      hashToken(state) !== hashToken(expected) ||
      !c.req.query('code')
    )
      throw apiError(400, 'Discord sign-in expired. Please try again.');
    deleteCookie(c, 'yoru_discord_state', cookieOptions(c));
    const db = c.get('db');
    const record = await db.get(
      'DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? AND (user_id IS NULL OR (user_id=? AND session_hash=?)) RETURNING *',
      hashToken(state),
      Date.now(),
      c.get('user')?.id || '',
      c.get('sessionHash'),
    );
    if (!record)
      throw apiError(400, 'Discord sign-in expired or your session changed. Please try again.');
    const token = await remoteJson('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.env.DISCORD_CLIENT_ID,
        client_secret: c.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: c.req.query('code'),
        redirect_uri: c.env.DISCORD_REDIRECT_URI,
      }),
    });
    const profile = await remoteJson('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!/^\d+$/.test(String(profile.id)))
      throw apiError(502, 'Discord returned an invalid profile.');
    let user = await db.get('SELECT * FROM users WHERE discord_id=?', profile.id);
    if (record.user_id && user && record.user_id !== user.id)
      throw apiError(409, 'This Discord account is connected to another Yoru account.');
    const avatar =
      profile.avatar && /^[a-zA-Z0-9_]+$/.test(profile.avatar)
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128`
        : '';
    if (record.user_id) {
      const updated = await db.run(
        `UPDATE users SET discord_id=?,avatar=? WHERE id=? AND ${liveSession}`,
        profile.id,
        avatar,
        record.user_id,
        ...sessionValues(c),
      );
      if (!changes(updated)) throw apiError(401, 'Your session changed. Sign in again.');
      user = await db.get('SELECT * FROM users WHERE id=?', record.user_id);
    } else if (!user) {
      const id = randomUUID();
      // A matching provider email never links an existing account.
      await db.run(
        'INSERT INTO users(id,name,discord_id,avatar,created_at) VALUES(?,?,?,?,?) ON CONFLICT(discord_id) DO NOTHING',
        id,
        text(profile.global_name || profile.username || 'Member', { min: 1, max: 80 }).slice(0, 40),
        profile.id,
        avatar,
        now(),
      );
      user = await db.get('SELECT * FROM users WHERE discord_id=?', profile.id);
    }
    if (!record.user_id) await issueSession(c, user.id);
    return c.redirect('/?signedIn=discord');
  });
}
