import { randomUUID } from 'node:crypto';
import { apiError, text, numeric, bool } from './validation.js';
import { forumBoards, forumKinds, forumScope } from '../shared/forum.js';

export const forumSchema = `
CREATE TABLE IF NOT EXISTS forum_topics (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection TEXT NOT NULL DEFAULT 'yoru', board TEXT NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, spoiler INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS forum_topics_board ON forum_topics(collection, board, created_at);
CREATE TABLE IF NOT EXISTS forum_replies (
  id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL,
  spoiler INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS forum_replies_topic ON forum_replies(topic_id, created_at);
`;
const author = (row) => ({ id: row.user_id, name: row.name, avatar: row.avatar || '' });
const shape = (row) => ({
  id: row.id,
  board: row.board,
  kind: row.kind,
  title: row.title,
  body: row.body,
  spoiler: Boolean(row.spoiler),
  author: author(row),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  latest: row.latest || row.created_at,
  replies: Number(row.replies || 0),
});
const topicQuery = `SELECT t.*, u.name, u.avatar,
  (SELECT COUNT(*) FROM forum_replies r WHERE r.topic_id=t.id) AS replies,
  COALESCE((SELECT MAX(created_at) FROM forum_replies r WHERE r.topic_id=t.id),t.created_at) AS latest
  FROM forum_topics t JOIN users u ON u.id=t.user_id`;
const scope = (input) => forumScope(input.collection);
const pageOf = (input) =>
  numeric(Number(input.page || 1), { name: 'Page', min: 1, max: 10000, integer: true });
const content = (input) => ({
  body: text(input.body, { name: 'Post', min: 1, max: 10000 }),
  spoiler: input.spoiler === undefined ? false : bool(input.spoiler, 'Spoiler'),
});
function topicInput(input) {
  if (!forumBoards.some((b) => b.id === input.board))
    throw apiError(400, 'Choose a forum channel.');
  if (!forumKinds.includes(input.kind)) throw apiError(400, 'Choose a topic type.');
  return {
    ...content(input),
    title: text(input.title, { name: 'Title', min: 3, max: 160 }),
    board: input.board,
    kind: input.kind,
  };
}
export async function forumBoardList(db, input) {
  const counts = await db.all(
    `SELECT t.board, COUNT(*) AS topics,
      COUNT(*) + SUM((SELECT COUNT(*) FROM forum_replies r WHERE r.topic_id=t.id)) AS messages
      FROM forum_topics t WHERE t.collection=? GROUP BY t.board`,
    scope(input),
  );
  const latest = await db.all(
    `WITH posts AS (
      SELECT t.board,t.id AS topic_id,t.title,t.user_id,t.created_at,t.id AS post_id
        FROM forum_topics t WHERE t.collection=?
      UNION ALL
      SELECT t.board,t.id,t.title,r.user_id,r.created_at,r.id
        FROM forum_replies r JOIN forum_topics t ON t.id=r.topic_id WHERE t.collection=?
    ), ranked AS (
      SELECT *,ROW_NUMBER() OVER (PARTITION BY board ORDER BY created_at DESC,post_id DESC) AS position FROM posts
    )
    SELECT p.board,p.topic_id,p.title,p.created_at,u.name
      FROM ranked p JOIN users u ON u.id=p.user_id WHERE p.position=1`,
    scope(input),
    scope(input),
  );
  return {
    items: forumBoards.map((board) => {
      const count = counts.find((row) => row.board === board.id);
      const post = latest.find((row) => row.board === board.id);
      return {
        ...board,
        topics: Number(count?.topics || 0),
        messages: Number(count?.messages || 0),
        latest: post
          ? { id: post.topic_id, title: post.title, name: post.name, createdAt: post.created_at }
          : null,
      };
    }),
  };
}
export async function forumTopicList(db, input) {
  const page = pageOf(input);
  const q = text(input.q || '', { name: 'Search', max: 100 }).toLowerCase();
  const params = [scope(input)];
  let where = ' WHERE t.collection=?';
  if (input.board && input.board !== 'all') {
    if (!forumBoards.some((b) => b.id === input.board))
      throw apiError(400, 'Choose a forum channel.');
    where += ' AND t.board=?';
    params.push(input.board);
  }
  if (q) {
    where += ' AND instr(lower(t.title),?)>0';
    params.push(q);
  }
  const total = Number(
    (await db.get(`SELECT COUNT(*) AS count FROM forum_topics t${where}`, ...params)).count,
  );
  const order =
    input.sort === 'newest'
      ? 't.created_at DESC'
      : input.sort === 'replies'
        ? 'replies DESC, latest DESC'
        : 'latest DESC';
  const items = await db.all(
    `${topicQuery}${where} ORDER BY ${order},t.id DESC LIMIT 20 OFFSET ?`,
    ...params,
    (page - 1) * 20,
  );
  return {
    items: items.map((row) => {
      const { body, ...topic } = shape(row);
      return topic;
    }),
    page,
    pages: Math.max(1, Math.ceil(total / 20)),
    total,
  };
}
async function findTopic(db, id, input) {
  const row = await db.get(`${topicQuery} WHERE t.id=? AND t.collection=?`, id, scope(input));
  if (!row) throw apiError(404, 'Topic not found.');
  return row;
}
export async function forumTopic(db, id, input) {
  const row = await findTopic(db, id, input),
    page = pageOf(input);
  const items = await db.all(
    `SELECT r.*,u.name,u.avatar FROM forum_replies r JOIN users u ON u.id=r.user_id WHERE topic_id=? ORDER BY r.created_at,r.id LIMIT 30 OFFSET ?`,
    id,
    (page - 1) * 30,
  );
  return {
    topic: shape(row),
    items: items.map(shape),
    page,
    pages: Math.max(1, Math.ceil(row.replies / 30)),
  };
}
export async function createForumTopic(db, input, userId) {
  const value = topicInput(input),
    id = randomUUID(),
    now = new Date().toISOString();
  await db.run(
    'INSERT INTO forum_topics(id,user_id,collection,board,kind,title,body,spoiler,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    id,
    userId,
    scope(input),
    value.board,
    value.kind,
    value.title,
    value.body,
    Number(value.spoiler),
    now,
    now,
  );
  return { id };
}
export async function replyForumTopic(db, id, input, userId) {
  await findTopic(db, id, input);
  const value = content(input),
    replyId = randomUUID(),
    now = new Date().toISOString();
  await db.run(
    'INSERT INTO forum_replies(id,topic_id,user_id,body,spoiler,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    replyId,
    id,
    userId,
    value.body,
    Number(value.spoiler),
    now,
    now,
  );
  return { id: replyId };
}
export async function editForumPost(db, id, input, userId, reply = false) {
  const row = reply
    ? await db.get(
        'SELECT r.* FROM forum_replies r JOIN forum_topics t ON t.id=r.topic_id WHERE r.id=? AND t.collection=? AND r.user_id=?',
        id,
        scope(input),
        userId,
      )
    : await db.get(
        'SELECT * FROM forum_topics WHERE id=? AND collection=? AND user_id=?',
        id,
        scope(input),
        userId,
      );
  if (!row) throw apiError(404, 'Your post was not found.');
  const value = content(input);
  await db.run(
    `UPDATE ${reply ? 'forum_replies' : 'forum_topics'} SET body=?,spoiler=?,updated_at=? WHERE id=? AND user_id=?`,
    value.body,
    Number(value.spoiler),
    new Date().toISOString(),
    id,
    userId,
  );
  return { ok: true };
}
