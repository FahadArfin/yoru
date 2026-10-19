import { all, get, run, transaction } from './db.js';
import { cookie } from './auth.js';
import { nodeReaderDb } from './reader-db.js';
import { getMedia, coreAccountMedia } from './catalog-core.js';
import { resolveReaderContext, nodeReaderSignal, READER_GUEST_COOKIE } from './reader-context.js';
import { createExtensionGateway } from './extension-gateway.js';
import { createSocialPolicy, authorizeSocialRequest } from './native-social-policy.js';
import { scheduleOptions } from './schedule-storage.js';
import { socialDestination } from '../shared/native-social-contract.js';
import { apiError } from './validation.js';

export async function socialRequest(req, res, { fresh = false } = {}) {
  if (!fresh && req.socialPolicy) return req.socialPolicy;
  const input = { ...req.query };
  input.destination = socialDestination(input);
  if (!input.destination) throw apiError(400, 'Choose one valid destination.');
  const db = nodeReaderDb({ all, get, run, transaction });
  const context = await resolveReaderContext(input, {
    db,
    userId: req.user?.id,
    sessionHash: req.sessionHash,
    guestId: cookie(req, READER_GUEST_COOKIE),
    extensionsEnabled: process.env.READER_EXTENSIONS_ENABLED,
    signal: req.socialSignal || (req.socialSignal = nodeReaderSignal(req, res)),
  });
  const policy = createSocialPolicy(
    context,
    {
      db,
      coreMedia: getMedia,
      coreAccountMedia,
      bridge: createExtensionGateway({
        ...scheduleOptions,
        bridgeUrl: process.env.READER_BRIDGE_URL,
        bridgeKey: process.env.READER_BRIDGE_KEY,
        extensionsEnabled: process.env.READER_EXTENSIONS_ENABLED,
      }),
    },
    input,
  );
  if (!fresh) req.socialPolicy = policy;
  const resolved = await policy;
  if (!fresh) req.resolvedSocialPolicy = resolved;
  return resolved;
}

// Existing synchronous Node mutations retain their transaction boundaries. The
// same policy/session/revision assertions run in that transaction before writes.
export function socialTransaction(req, mutation) {
  const policy = req.resolvedSocialPolicy;
  if (!policy) throw apiError(500, 'Missing social policy.');
  return transaction(() => {
    try {
      for (const check of policy.guardStatements({ identity: true }))
        all(check.sql, ...check.values);
    } catch (error) {
      if (/malformed JSON/.test(error.message))
        throw apiError(409, 'The title or your preferences changed. Reload and try again.');
      throw error;
    }
    return mutation();
  });
}

export async function socialAccess(req, res, next) {
  if (
    !/^\/(?:comments|reviews|rooms|community|events)(?:\/|$)/.test(req.path) ||
    /^\/rooms\/[^/]+\/leave\/?$/.test(req.path)
  )
    return next();
  const policy = await socialRequest(req, res);
  res.set('Cache-Control', 'no-store');
  req.socialAccess = await authorizeSocialRequest(
    policy,
    req.method,
    req.path,
    req.query,
    req.body || {},
  );
  next();
}
