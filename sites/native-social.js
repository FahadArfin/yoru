import { getCookie } from 'hono/cookie';
import { sitesReaderDb } from './store.js';
import { getMedia, coreAccountMedia } from '../server/catalog-core.js';
import { resolveReaderContext, READER_GUEST_COOKIE } from '../server/reader-context.js';
import { createExtensionGateway } from '../server/extension-gateway.js';
import { createSocialPolicy, authorizeSocialRequest } from '../server/native-social-policy.js';
import { scheduleOptions } from './schedule-storage.js';
import { socialDestination } from '../shared/native-social-contract.js';
import { apiError } from '../server/validation.js';

export async function socialRequest(c, { fresh = false } = {}) {
  if (!fresh && c.get('socialPolicy')) return c.get('socialPolicy');
  const input = c.req.query();
  input.destination = socialDestination(input);
  if (!input.destination) throw apiError(400, 'Choose one valid destination.');
  const db = sitesReaderDb(c.get('db'));
  const context = await resolveReaderContext(input, {
    db,
    userId: c.get('user')?.id,
    sessionHash: c.get('sessionHash'),
    guestId: getCookie(c, READER_GUEST_COOKIE),
    extensionsEnabled: c.env.READER_EXTENSIONS_ENABLED,
    signal: c.req.raw.signal,
  });
  const policy = createSocialPolicy(
    context,
    {
      db,
      coreMedia: getMedia,
      coreAccountMedia,
      bridge: createExtensionGateway({
        ...scheduleOptions(c.env),
        bridgeUrl: c.env.READER_BRIDGE_URL,
        bridgeKey: c.env.READER_BRIDGE_KEY,
        extensionsEnabled: c.env.READER_EXTENSIONS_ENABLED,
      }),
    },
    input,
  );
  if (!fresh) c.set('socialPolicy', policy);
  return policy;
}

export async function socialDatabase(c) {
  const policy = await socialRequest(c),
    db = c.get('db');
  const batch = async (statements) => {
    await policy.current();
    const checks = policy.guardStatements({ identity: true });
    try {
      return (
        await db.batch([...checks.map((s) => db.statement(s.sql, ...s.values)), ...statements])
      ).slice(checks.length);
    } catch (error) {
      if (/malformed JSON/.test(error.message))
        throw apiError(409, 'The title or your preferences changed. Reload and try again.');
      throw error;
    }
  };
  return {
    ...db,
    batch,
    run: async (sql, ...values) => (await batch([db.statement(sql, ...values)]))[0],
    get: async (sql, ...values) =>
      /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)
        ? (await batch([db.statement(sql, ...values)]))[0].results[0] || null
        : db.get(sql, ...values),
  };
}

export async function socialAccess(c, next) {
  if (
    !/^\/api\/(?:comments|reviews|rooms|community|events|poll)(?:\/|$)/.test(c.req.path) ||
    /^\/api\/rooms\/[^/]+\/leave\/?$/.test(c.req.path)
  )
    return next();
  const policy = await socialRequest(c);
  c.header('Cache-Control', 'no-store');
  const body = ['GET', 'HEAD'].includes(c.req.method) ? {} : await c.req.json().catch(() => ({}));
  c.set(
    'socialAccess',
    await authorizeSocialRequest(policy, c.req.method, c.req.path, c.req.query(), body),
  );
  await next();
  // Hono has not delivered the response yet: invalidate stale metadata or
  // preference/session proof after asynchronous reads as well as writes.
  await policy.atomic([]);
}
