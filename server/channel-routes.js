import { Router } from 'express';
import { all, get, run } from './db.js';
import { apiError, asyncRoute, requireAuth } from './auth.js';
import { channelList, createChannel, channelMessages, postChannelMessage } from './channels.js';

export function channelRouter() {
  const router = Router(),
    db = { all, get, run };
  const writer = (req) => ({
    ...db,
    run: (sql, ...values) => {
      if (
        !get(
          'SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',
          req.sessionHash,
          req.user.id,
          Date.now(),
        )
      )
        throw apiError(401, 'Your session changed. Sign in again.');
      return run(sql, ...values);
    },
  });
  router.get(
    '/',
    asyncRoute(async (req, res) => res.json(await channelList(db, req.query))),
  );
  router.post(
    '/',
    requireAuth,
    asyncRoute(async (req, res) =>
      res.status(201).json(await createChannel(writer(req), req.body, req.user.id)),
    ),
  );
  router.get(
    '/:id/messages',
    asyncRoute(async (req, res) => res.json(await channelMessages(db, req.params.id, req.query))),
  );
  router.post(
    '/:id/messages',
    requireAuth,
    asyncRoute(async (req, res) =>
      res
        .status(201)
        .json(await postChannelMessage(writer(req), req.params.id, req.body, req.user.id)),
    ),
  );
  return router;
}
