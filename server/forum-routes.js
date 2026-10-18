import { Router } from 'express';
import { all, get, run } from './db.js';
import { apiError, asyncRoute, requireAuth } from './auth.js';
import {
  forumBoardList,
  forumTopicList,
  forumTopic,
  createForumTopic,
  replyForumTopic,
  editForumPost,
} from './forum.js';

export function forumRouter(onChange) {
  const router = Router(),
    db = { all, get, run };
  const guarded = (req) => ({
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
    '/boards',
    asyncRoute(async (req, res) => res.json(await forumBoardList(db, req.query))),
  );
  router.get(
    '/topics',
    asyncRoute(async (req, res) => res.json(await forumTopicList(db, req.query))),
  );
  router.get(
    '/topics/:id',
    asyncRoute(async (req, res) => res.json(await forumTopic(db, req.params.id, req.query))),
  );
  router.post(
    '/topics',
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await createForumTopic(guarded(req), req.body, req.user.id);
      onChange({ id: result.id });
      res.status(201).json(result);
    }),
  );
  router.post(
    '/topics/:id/replies',
    requireAuth,
    asyncRoute(async (req, res) => {
      const result = await replyForumTopic(guarded(req), req.params.id, req.body, req.user.id);
      onChange({ id: req.params.id });
      res.status(201).json(result);
    }),
  );
  for (const kind of ['topics', 'replies'])
    router.patch(
      `/${kind}/:id`,
      requireAuth,
      asyncRoute(async (req, res) => {
        const result = await editForumPost(
          guarded(req),
          req.params.id,
          req.body,
          req.user.id,
          kind === 'replies',
        );
        onChange({});
        res.json(result);
      }),
    );
  return router;
}
