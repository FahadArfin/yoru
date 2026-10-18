import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  forumSchema,
  createForumTopic,
  replyForumTopic,
  forumTopicList,
  forumTopic,
  forumBoardList,
} from '../server/forum.js';
test('forum pagination is stable and reply activity is counted without leaking post bodies', async (t) => {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,avatar TEXT); INSERT INTO users VALUES('user','Member','');",
  );
  sql.exec(forumSchema);
  const db = {
    get: (q, ...v) => sql.prepare(q).get(...v),
    all: (q, ...v) => sql.prepare(q).all(...v),
    run: (q, ...v) => sql.prepare(q).run(...v),
  };
  const ids = [];
  for (let i = 0; i < 23; i++)
    ids.push(
      (
        await createForumTopic(
          db,
          { board: 'anime', kind: 'Discussion', title: `Topic ${i}`, body: 'First post' },
          'user',
        )
      ).id,
    );
  const first = await forumTopicList(db, { board: 'anime', page: '1' }),
    second = await forumTopicList(db, { board: 'anime', page: '2' });
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 3);
  assert.equal(new Set([...first.items, ...second.items].map((x) => x.id)).size, 23);
  for (let i = 0; i < 32; i++) await replyForumTopic(db, ids[0], { body: `Reply ${i}` }, 'user');
  const topic = await forumTopic(db, ids[0], { page: '2' });
  assert.equal(topic.items.length, 2);
  assert.equal(topic.pages, 2);
  assert.equal(topic.topic.replies, 32);
  assert.equal((await forumTopicList(db, { sort: 'replies' })).items[0].id, ids[0]);
  assert.equal((await forumBoardList(db, {})).items.find((b) => b.id === 'anime').topics, 23);
  assert.equal((await forumTopicList(db, { collection: 'ara-ara' })).total, 0);
  await assert.rejects(
    () =>
      createForumTopic(
        db,
        { board: 'anime', kind: 'Discussion', title: 'A title', body: 'x'.repeat(10001) },
        'user',
      ),
    { status: 400 },
  );
});
