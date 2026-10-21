import { requireAuth } from './security.js';
import {
  channelList,
  createChannel,
  channelMessages,
  postChannelMessage,
} from '../server/channels.js';
export function channelRoutes(app) {
  app.get('/api/channels', async (c) => c.json(await channelList(c.get('db'), c.req.query())));
  app.post('/api/channels', requireAuth, async (c) =>
    c.json(await createChannel(c.get('db'), await c.req.json(), c.get('user').id), 201),
  );
  app.get('/api/channels/:id/messages', async (c) =>
    c.json(await channelMessages(c.get('db'), c.req.param('id'), c.req.query())),
  );
  app.post('/api/channels/:id/messages', requireAuth, async (c) =>
    c.json(
      await postChannelMessage(
        c.get('db'),
        c.req.param('id'),
        await c.req.json(),
        c.get('user').id,
      ),
      201,
    ),
  );
}
