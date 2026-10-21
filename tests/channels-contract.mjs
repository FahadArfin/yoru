import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function channelsContract(request, register) {
  const member = await register(`Chat${randomUUID().slice(0, 8)}`);
  const name = `Book club ${randomUUID().slice(0, 8)}`;
  const create = (body, session = member) =>
    request('/api/channels', { method: 'POST', body, session });
  assert.equal((await create({ name }, null)).status, 401);
  assert.equal((await create({ name, visibility: 'private' })).status, 400);
  const made = await create({ name, description: 'Everyone is welcome.' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const channel = made.body.channel;
  assert.equal(channel.visibility, 'public');
  assert.equal((await create({ name: name.toUpperCase() })).status, 409);
  const list = await request(`/api/channels?q=${encodeURIComponent(name)}`);
  assert.equal(list.body.items[0].id, channel.id);
  const path = `/api/channels/${channel.id}/messages`;
  assert.equal((await request(path)).status, 200);
  assert.equal((await request(path, { method: 'POST', body: { body: 'Guest' } })).status, 401);
  const sent = await request(path, {
    method: 'POST',
    session: member,
    body: { body: 'First message', userId: 'forged' },
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.author.name, member.user.name);
  const second = await request(path, {
    method: 'POST',
    session: member,
    body: { body: 'Second message' },
  });
  const latest = await request(path);
  assert.deepEqual(
    latest.body.items.map((x) => x.body),
    ['First message', 'Second message'],
  );
  const older = await request(`${path}?before=${sent.body.message.id}`);
  assert.equal(older.body.items.length, 0);
  const newer = await request(`${path}?after=${sent.body.message.id}`);
  assert.deepEqual(
    newer.body.items.map((x) => x.id),
    [second.body.message.id],
  );
  const general = await request('/api/channels/general/messages');
  assert.ok(!general.body.items.some((x) => x.id === sent.body.message.id));
  const legacy = await request('/api/chat');
  assert.ok(!legacy.body.items.some((x) => x.id === sent.body.message.id));
  assert.equal(
    (await request(`/api/channels/general/messages?after=${sent.body.message.id}`)).status,
    400,
  );
  const old = await request('/api/chat', {
    method: 'POST',
    session: member,
    body: { body: 'Legacy general message' },
  });
  assert.ok(
    (await request('/api/channels/general/messages')).body.items.some(
      (x) => x.id === old.body.message.id,
    ),
  );
  assert.equal((await request('/api/channels/missing/messages')).status, 404);
  assert.equal(
    (await request(path, { method: 'POST', session: member, body: { body: 'x'.repeat(2001) } }))
      .status,
    400,
  );
  assert.equal(
    (await request('/api/auth/logout', { method: 'POST', session: member, body: {} })).status,
    200,
  );
  assert.equal(
    (await request(path, { method: 'POST', session: member, body: { body: 'Revoked' } })).status,
    401,
  );
}
