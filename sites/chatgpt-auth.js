import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import { apiError } from '../server/validation.js';
import { authReturnPath } from '../shared/chatgpt-auth.js';
import {
  cookieOptions,
  hashToken,
  randomToken,
  requireAuth,
  rateLimit,
  issueSession,
} from './security.js';
import { changes, now } from './store.js';

const COOKIE = 'yoru_chatgpt_state';
// Only the Sites Worker consumes these gateway-owned headers. Node never trusts them.
function identity(c) {
  const id = c.req.header('oai-authenticated-user-id');
  const email = c.req.header('oai-authenticated-user-email');
  if (
    !id ||
    id.length > 512 ||
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw apiError(401, 'ChatGPT sign-in did not finish. Please try again.');
  // Use a neutral public name until the member chooses one; never expose their email.
  return { id, email: email.toLowerCase() };
}
async function start(c, linking) {
  if (!linking && c.get('user')) return c.redirect('/settings');
  await rateLimit(c, 'auth', 30, 15 * 60000);
  const input = linking ? await c.req.json() : c.req.query();
  const state = randomToken();
  const returnTo = authReturnPath(input.returnTo, '/settings');
  await c
    .get('db')
    .run(
      'INSERT INTO chatgpt_states(state_hash,user_id,session_hash,return_path,expires_at) VALUES(?,?,?,?,?)',
      hashToken(state),
      linking ? c.get('user').id : null,
      linking ? c.get('sessionHash') : null,
      returnTo,
      Date.now() + 600000,
    );
  setCookie(c, COOKIE, state, { ...cookieOptions(c), maxAge: 600 });
  const callback = `/api/auth/chatgpt/complete?state=${encodeURIComponent(state)}`;
  const url = `/signin-with-chatgpt?return_to=${encodeURIComponent(callback)}`;
  return linking ? c.json({ url }) : c.redirect(url);
}
export function chatgptRoutes(app) {
  app.get('/api/auth/chatgpt/start', (c) => start(c, false));
  app.post('/api/auth/chatgpt/connect', requireAuth, (c) => start(c, true));
  app.get('/api/auth/chatgpt/complete', async (c) => {
    try {
      const state = c.req.query('state') || '';
      const cookie = getCookie(c, COOKIE);
      if (!state || state.length > 128 || !cookie || hashToken(state) !== hashToken(cookie))
        throw apiError(400, 'ChatGPT sign-in expired. Please start again.');
      deleteCookie(c, COOKIE, cookieOptions(c));
      const visitor = identity(c);
      const db = c.get('db');
      const record = await db.get(
        'DELETE FROM chatgpt_states WHERE state_hash=? AND expires_at>? RETURNING *',
        hashToken(state),
        Date.now(),
      );
      if (!record) throw apiError(400, 'ChatGPT sign-in expired. Please start again.');
      let user = await db.get('SELECT * FROM users WHERE chatgpt_id=?', visitor.id);
      if (record.user_id) {
        if (c.get('user')?.id !== record.user_id || c.get('sessionHash') !== record.session_hash)
          throw apiError(401, 'Your Yoru session changed. Sign in and connect ChatGPT again.');
        if (user && user.id !== record.user_id)
          throw apiError(409, 'This ChatGPT account is already connected to another Yoru account.');
        try {
          const result = await db
            .guard(record.session_hash, record.user_id)
            .run(
              'UPDATE users SET chatgpt_id=? WHERE id=? AND (chatgpt_id IS NULL OR chatgpt_id=?)',
              visitor.id,
              record.user_id,
              visitor.id,
            );
          if (!changes(result))
            throw apiError(
              409,
              'This Yoru account already has a different ChatGPT account connected.',
            );
        } catch (error) {
          if (String(error.message).includes('UNIQUE'))
            throw apiError(
              409,
              'This ChatGPT account is already connected to another Yoru account.',
            );
          throw error;
        }
        // Keep the authenticated Yoru session and all its existing data.
        return c.redirect(record.return_path);
      }
      if (c.get('user'))
        throw apiError(
          409,
          'Your Yoru session changed. Sign out before starting ChatGPT sign-in again.',
        );
      if (!user) {
        if (await db.get('SELECT id FROM users WHERE lower(email)=?', visitor.email))
          throw apiError(
            409,
            'A Yoru account already uses this email. Sign in with your password, then connect ChatGPT in Settings to keep your saved activity.',
          );
        try {
          await db.run(
            'INSERT INTO users(id,name,email,chatgpt_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT(chatgpt_id) DO NOTHING',
            randomUUID(),
            'Yoru reader',
            visitor.email,
            visitor.id,
            now(),
          );
        } catch (error) {
          if (String(error.message).includes('UNIQUE'))
            throw apiError(
              409,
              'Sign in to your existing Yoru account, then connect ChatGPT in Settings.',
            );
          throw error;
        }
        user = await db.get('SELECT * FROM users WHERE chatgpt_id=?', visitor.id);
      }
      await issueSession(c, user.id, 'chatgpt');
      return c.redirect(record.return_path);
    } catch (error) {
      const message = error.expose
        ? error.message
        : 'ChatGPT sign-in could not finish. Please try again.';
      return c.redirect(`/settings?authError=${encodeURIComponent(message)}`);
    }
  });
}
