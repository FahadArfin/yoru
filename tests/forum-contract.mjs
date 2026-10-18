import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function forumContract(request, register) {
  const owner = await register(`Forum${randomUUID().slice(0, 8)}`);
  const other = await register(`Other${randomUUID().slice(0, 8)}`);
  const title = `Shelf care ${randomUUID()}`;
  const input = {
    board: 'figures',
    kind: 'Question',
    title,
    body: 'How do you keep your shelves dust-free?',
    spoiler: false,
  };
  const boards = await request('/api/forum/boards');
  assert.equal(boards.status, 200);
  assert.ok(boards.body.items.some((b) => b.id === 'manhwa'));
  assert.ok(boards.body.items.some((b) => b.id === 'figures'));
  assert.equal((await request('/api/forum/topics', { method: 'POST', body: input })).status, 401);
  assert.equal(
    (
      await request('/api/forum/topics', {
        method: 'POST',
        session: owner,
        body: { ...input, board: 'unknown' },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/api/forum/topics', {
        method: 'POST',
        session: owner,
        body: { ...input, spoiler: 'false' },
      })
    ).status,
    400,
  );
  const created = await request('/api/forum/topics', {
    method: 'POST',
    session: owner,
    body: { ...input, userId: other.user.id },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const path = `/api/forum/topics/${created.body.id}`;
  const detail = await request(path);
  assert.equal(detail.body.topic.author.id, owner.user.id);
  assert.equal(detail.body.topic.body, input.body);
  assert.equal((await request(`${path}?collection=ara-ara`)).status, 404);
  assert.equal(
    (
      await request(`${path}/replies`, {
        method: 'POST',
        session: other,
        body: { body: 'wrong collection', collection: 'ara-ara' },
      })
    ).status,
    404,
  );
  assert.equal(
    (await request(path, { method: 'PATCH', session: other, body: { body: 'stolen' } })).status,
    404,
  );
  const reply = await request(`${path}/replies`, {
    method: 'POST',
    session: other,
    body: { body: 'Use a soft brush. <script>alert(1)</script>', spoiler: true },
  });
  assert.equal(reply.status, 201);
  const updated = await request(path);
  assert.equal(updated.body.topic.replies, 1);
  assert.equal(updated.body.items[0].spoiler, true);
  assert.equal(updated.body.items[0].author.id, other.user.id);
  const afterBoards = (await request('/api/forum/boards')).body.items;
  const beforeFigures = boards.body.items.find((b) => b.id === 'figures');
  const afterFigures = afterBoards.find((b) => b.id === 'figures');
  assert.equal(afterFigures.topics, beforeFigures.topics + 1);
  assert.equal(afterFigures.messages, beforeFigures.messages + 2);
  assert.equal(afterFigures.latest.id, created.body.id);
  assert.equal(afterFigures.latest.name, other.user.name);
  assert.equal(Object.hasOwn(afterFigures.latest, 'body'), false);
  const otherBoards = (await request('/api/forum/boards?collection=ara-ara')).body.items;
  assert.ok(otherBoards.every((b) => b.latest?.id !== created.body.id));
  const replyPath = `/api/forum/replies/${reply.body.id}`;
  assert.equal(
    (await request(replyPath, { method: 'PATCH', session: owner, body: { body: 'not mine' } }))
      .status,
    404,
  );
  assert.equal(
    (
      await request(replyPath, {
        method: 'PATCH',
        session: other,
        body: { body: 'A clean soft brush.', spoiler: false },
      })
    ).status,
    200,
  );
  assert.equal((await request(path)).body.items[0].body, 'A clean soft brush.');
  const found = await request(
    `/api/forum/topics?board=figures&q=${encodeURIComponent(title)}&sort=replies`,
  );
  assert.equal(found.body.total, 1);
  assert.equal(found.body.items[0].id, created.body.id);
  assert.equal(Object.hasOwn(found.body.items[0], 'body'), false);
  assert.equal(
    (await request(`/api/forum/topics?board=anime&q=${encodeURIComponent(title)}`)).body.total,
    0,
  );
  assert.equal((await request('/api/forum/topics?page=-1')).status, 400);
  assert.equal((await request('/api/forum/topics?q=%25')).body.total, 0);
  const privateTopic = await request('/api/forum/topics', {
    method: 'POST',
    session: owner,
    body: { ...input, collection: 'ara-ara' },
  });
  assert.equal(privateTopic.status, 201);
  assert.equal((await request(`/api/forum/topics/${privateTopic.body.id}`)).status, 404);
  assert.equal(
    (await request(`/api/forum/topics/${privateTopic.body.id}?collection=ara-ara`)).status,
    200,
  );
}
