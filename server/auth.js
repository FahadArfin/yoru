import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { get, run, now } from './db.js';
import { parseMediaReference } from '../shared/media-reference.js';

const scrypt = promisify(scryptCallback);
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const COOKIE = 'yoru_session';
const DISCORD_COOKIE = 'yoru_discord_state';
const secureCookies =
  process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';
const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/' };
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
export const authEvents = new EventEmitter();
export const discordEnabled = Boolean(
  process.env.DISCORD_CLIENT_ID &&
    process.env.DISCORD_CLIENT_SECRET &&
    process.env.DISCORD_REDIRECT_URI,
);

export function cookie(req, name) {
  const entry = (req.headers.cookie || '')
    .split(';')
    .find((part) => part.trim().startsWith(`${name}=`));
  if (!entry) return '';
  try {
    return decodeURIComponent(entry.trim().slice(name.length + 1));
  } catch {
    return '';
  }
}
export const publicUser = (user) =>
  user
    ? { id: user.id, name: user.name, avatar: user.avatar || '', createdAt: user.created_at }
    : null;
export const ownUser = (user) =>
  user
    ? { ...publicUser(user), email: user.email || '', discordConnected: Boolean(user.discord_id) }
    : null;

export function sessionMiddleware(req, _res, next) {
  const token = cookie(req, COOKIE);
  if (token && token.length <= 128) {
    const session = get(
      'SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?',
      hashToken(token),
      Date.now(),
    );
    if (session) {
      req.user = session;
      req.sessionHash = hashToken(token);
    }
  }
  next();
}
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  next();
}
export function apiError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}
export function text(value, { name = 'Text', min = 0, max = 1000 } = {}) {
  if (typeof value !== 'string') throw apiError(400, `${name} must be text.`);
  const result = value.trim();
  if (
    result.length < min ||
    result.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)
  )
    throw apiError(400, `${name} must contain ${min}–${max} characters.`);
  return result;
}
export function numeric(value, { name = 'Value', min = 0, max = 100000, integer = false } = {}) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw apiError(
      400,
      `${name} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`,
    );
  return value;
}
export function mediaId(value) {
  if (!parseMediaReference(value)) throw apiError(400, 'Invalid title ID.');
  return value;
}
export const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function originGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  let allowed = false;
  try {
    const parsed = new URL(origin);
    const configured = (process.env.APP_ORIGIN || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    allowed = configured.length
      ? configured.includes(parsed.origin)
      : parsed.origin === requestOrigin;
    if (
      process.env.NODE_ENV !== 'production' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    ) {
      const remote = req.socket.remoteAddress || '';
      if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) allowed = true;
    }
  } catch {
    /* A missing or opaque origin is not a browser write. */
  }
  if (!allowed)
    return res.status(403).json({ error: 'This request must come from the Yoru application.' });
  next();
}

async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}
async function passwordMatches(password, stored) {
  const [, salt, expected] = (
    stored || 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128)
  ).split(':');
  if (!salt || !expected) return false;
  const derived = await scrypt(password, salt, 64);
  const buffer = Buffer.from(expected, 'hex');
  return buffer.length === derived.length && timingSafeEqual(buffer, derived);
}
function issueSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  run('DELETE FROM sessions WHERE expires_at<=?', Date.now());
  run(
    'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
    hashToken(token),
    userId,
    Date.now() + SESSION_TTL,
    Date.now(),
  );
  res.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL });
}
export const authRouter = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
});
authRouter.get('/me', (req, res) => res.json({ user: ownUser(req.user) }));
authRouter.post(
  '/register',
  authLimiter,
  asyncRoute(async (req, res) => {
    const name = text(req.body.name, { name: 'Display name', min: 2, max: 40 });
    const email = text(req.body.email, { name: 'Email', min: 3, max: 254 }).toLowerCase();
    const password = text(req.body.password, { name: 'Password', min: 10, max: 128 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw apiError(400, 'Enter a valid email address.');
    if (get('SELECT id FROM users WHERE email=?', email))
      throw apiError(409, 'An account already exists for this email. Sign in instead.');
    const hashed = await passwordHash(password);
    const id = randomUUID();
    try {
      run(
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
    issueSession(res, id);
    res.status(201).json({ user: ownUser(get('SELECT * FROM users WHERE id=?', id)) });
  }),
);
authRouter.post(
  '/login',
  authLimiter,
  asyncRoute(async (req, res) => {
    const email = text(req.body.email, { name: 'Email', min: 3, max: 254 }).toLowerCase();
    const password = text(req.body.password, { name: 'Password', min: 1, max: 128 });
    const user = get('SELECT * FROM users WHERE email=?', email);
    if (!(await passwordMatches(password, user?.password_hash)) || !user?.password_hash)
      throw apiError(401, 'Email or password is incorrect.');
    issueSession(res, user.id);
    res.json({ user: ownUser(user) });
  }),
);
authRouter.post('/logout', (req, res) => {
  const token = cookie(req, COOKIE);
  if (token) {
    const tokenHash = hashToken(token);
    run('DELETE FROM sessions WHERE token_hash=?', tokenHash);
    authEvents.emit('session-revoked', { tokenHash, userId: req.user?.id });
  }
  res.clearCookie(COOKIE, cookieOptions);
  res.json({ user: null });
});
authRouter.get('/discord', authLimiter, (req, res) => {
  if (!discordEnabled)
    return res.status(503).json({ error: 'Discord sign-in has not been configured by the host.' });
  const state = randomBytes(32).toString('base64url');
  run('DELETE FROM oauth_states WHERE expires_at<=?', Date.now());
  run(
    'INSERT INTO oauth_states(state_hash,expires_at,user_id) VALUES(?,?,?)',
    hashToken(state),
    Date.now() + 10 * 60000,
    req.user?.id || null,
  );
  res.cookie(DISCORD_COOKIE, state, { ...cookieOptions, maxAge: 10 * 60000 });
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email',
    state,
  }).toString();
  res.redirect(url.toString());
});
authRouter.get(
  '/discord/callback',
  asyncRoute(async (req, res) => {
    if (!discordEnabled) throw apiError(503, 'Discord sign-in is unavailable.');
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const expected = cookie(req, DISCORD_COOKIE);
    const record =
      state &&
      get(
        'SELECT * FROM oauth_states WHERE state_hash=? AND expires_at>?',
        hashToken(state),
        Date.now(),
      );
    res.clearCookie(DISCORD_COOKIE, cookieOptions);
    if (
      !record ||
      !expected ||
      hashToken(state) !== hashToken(expected) ||
      typeof req.query.code !== 'string'
    )
      throw apiError(400, 'Discord sign-in expired. Please try again.');
    run('DELETE FROM oauth_states WHERE state_hash=?', hashToken(state));
    if (record.user_id && req.user?.id !== record.user_id)
      throw apiError(400, 'Your session changed. Please start Discord sign-in again.');
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!tokenResponse.ok)
      throw apiError(502, 'Discord could not complete sign-in. Please try again.');
    const token = await tokenResponse.json();
    const profileResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!profileResponse.ok) throw apiError(502, 'Discord could not load your profile.');
    const profile = await profileResponse.json();
    if (!/^\d+$/.test(String(profile.id)))
      throw apiError(502, 'Discord returned an invalid profile.');
    let user = get('SELECT * FROM users WHERE discord_id=?', profile.id);
    if (record.user_id && user && record.user_id !== user.id)
      throw apiError(409, 'This Discord account is connected to another Yoru account.');
    const avatar =
      profile.avatar && /^[a-zA-Z0-9_]+$/.test(profile.avatar)
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128`
        : '';
    if (record.user_id) {
      run('UPDATE users SET discord_id=?,avatar=? WHERE id=?', profile.id, avatar, record.user_id);
      user = get('SELECT * FROM users WHERE id=?', record.user_id);
    } else if (!user) {
      const id = randomUUID();
      // Never join accounts solely because an OAuth provider supplied a matching email.
      run(
        'INSERT INTO users(id,name,discord_id,avatar,created_at) VALUES(?,?,?,?,?)',
        id,
        text(profile.global_name || profile.username || 'Member', { min: 1, max: 80 }).slice(0, 40),
        profile.id,
        avatar,
        now(),
      );
      user = get('SELECT * FROM users WHERE id=?', id);
    }
    issueSession(res, user.id);
    res.redirect('/?signedIn=discord');
  }),
);
