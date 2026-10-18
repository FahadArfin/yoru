import { requireAuth } from './security.js';
import {
  forumBoardList,
  forumTopicList,
  forumTopic,
  createForumTopic,
  replyForumTopic,
  editForumPost,
} from '../server/forum.js';
export function forumRoutes(app) {
  app.get('/api/forum/boards', async (c) =>
    c.json(await forumBoardList(c.get('db'), c.req.query())),
  );
  app.get('/api/forum/topics', async (c) =>
    c.json(await forumTopicList(c.get('db'), c.req.query())),
  );
  app.get('/api/forum/topics/:id', async (c) =>
    c.json(await forumTopic(c.get('db'), c.req.param('id'), c.req.query())),
  );
  const writer = (c) => {
    const db = c.get('db');
    return {
      ...db,
      run: async (sql, ...values) =>
        (
          await db.batch([
            db.statement(sql, ...values),
            db.statement(
              'INSERT INTO event_log(event,payload,created_at) VALUES(?,?,?)',
              'forum',
              '{}',
              Date.now(),
            ),
          ])
        )[0],
    };
  };
  app.post('/api/forum/topics', requireAuth, async (c) => {
    const result = await createForumTopic(writer(c), await c.req.json(), c.get('user').id);
    return c.json(result, 201);
  });
  app.post('/api/forum/topics/:id/replies', requireAuth, async (c) => {
    const result = await replyForumTopic(
      writer(c),
      c.req.param('id'),
      await c.req.json(),
      c.get('user').id,
    );
    return c.json(result, 201);
  });
  for (const kind of ['topics', 'replies'])
    app.patch(`/api/forum/${kind}/:id`, requireAuth, async (c) => {
      const result = await editForumPost(
        writer(c),
        c.req.param('id'),
        await c.req.json(),
        c.get('user').id,
        kind === 'replies',
      );
      return c.json(result);
    });
}
