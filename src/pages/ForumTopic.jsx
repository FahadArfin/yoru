import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from '../collection-router';
import { ArrowLeft, MessageCircle, Pencil } from 'lucide-react';
import { useApp, useResource } from '../state';
import { useCollection } from '../collection-context';
import { send, ago } from '../api';
import { Avatar, ErrorNotice } from '../components';
import { ForumBody, ForumComposer } from '../Forum';
import { forumBoards } from '../../shared/forum';

export default function ForumTopic() {
  const { topicId } = useParams();
  const [page, setPage] = useState(1),
    [editing, setEditing] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const { user, requireUser, event } = useApp();
  const collection = useCollection()?.active ? 'ara-ara' : 'yoru';
  const resource = useResource(`/api/forum/topics/${topicId}?page=${page}`, false);
  const retained = useRef(null);
  const currentScope = useRef('');
  const scope = `${collection}:${topicId}:${user?.id || 'guest'}`;
  currentScope.current = scope;
  if (resource.data) retained.current = { scope, data: resource.data };
  const data = resource.data || (retained.current?.scope === scope ? retained.current.data : null);
  const topic = data?.topic;
  useEffect(() => {
    if (['forum', 'snapshot'].includes(event?.type)) resource.refresh();
  }, [event]);
  useEffect(() => {
    setEditing(null);
    setError('');
    setRevision((v) => v + 1);
    setBusy(false);
  }, [user?.id, topicId, collection]);
  useEffect(() => {
    setPage(1);
  }, [topicId]);
  async function save(input) {
    if (!requireUser() || busy) return;
    setBusy(true);
    setError('');
    const submissionScope = scope;
    try {
      await send(
        editing
          ? `/api/forum/${editing.id === topic.id ? 'topics' : 'replies'}/${editing.id}`
          : `/api/forum/topics/${topicId}/replies`,
        { ...input, collection },
        editing ? 'PATCH' : 'POST',
      );
      if (currentScope.current !== submissionScope) return;
      if (!editing) setPage(Math.max(1, Math.ceil(((topic?.replies || 0) + 1) / 30)));
      setEditing(null);
      if (!editing) setRevision((v) => v + 1);
      resource.refresh();
    } catch (e) {
      if (currentScope.current === submissionScope) setError(e.message);
    } finally {
      if (currentScope.current === submissionScope) setBusy(false);
    }
  }
  const post = (item, opener = false) => (
    <article className={`forum-post ${opener ? 'is-opener' : ''}`} key={item.id}>
      <div className="forum-post-byline">
        <Avatar user={item.author} />
        <div>
          <strong>{item.author.name}</strong>
          <small>
            {ago(item.createdAt)}
            {item.updatedAt !== item.createdAt ? ' · Edited' : ''}
          </small>
        </div>
        {opener && <span className="badge">Original post</span>}
        {user?.id === item.author.id && (
          <button
            className="text-link"
            disabled={busy}
            onClick={() => {
              setEditing(item);
              setError('');
            }}
          >
            <Pencil size={14} /> Edit
          </button>
        )}
      </div>
      {editing?.id === item.id ? (
        <ForumComposer
          key={item.id}
          initial={item}
          onSubmit={save}
          onCancel={() => {
            setEditing(null);
            setError('');
          }}
          busy={busy}
          error={error}
        />
      ) : (
        <ForumBody key={`${item.id}:${item.updatedAt}`} body={item.body} spoiler={item.spoiler} />
      )}
    </article>
  );
  return (
    <div className="page section-page forum-topic-page">
      <Link className="text-link" to={`/community${topic ? `?board=${topic.board}` : ''}`}>
        <ArrowLeft size={15} /> Back to forums
      </Link>
      {resource.error && <ErrorNotice message={resource.error} retry={resource.refresh} />}
      {!topic ? (
        <p role="status">Loading conversation…</p>
      ) : (
        <>
          <header className="forum-thread-heading">
            <span className="section-kicker">
              {forumBoards.find((b) => b.id === topic.board)?.name} · {topic.kind}
            </span>
            <h1>{topic.title}</h1>
            <span>
              <MessageCircle size={15} /> {topic.replies}{' '}
              {topic.replies === 1 ? 'reply' : 'replies'}
            </span>
            <p className="muted">Keep episode and chapter spoilers within their own discussions.</p>
          </header>
          {post(topic, true)}
          <section
            aria-label="Topic replies"
            className="forum-replies"
            aria-busy={resource.loading}
          >
            {(data.items || []).map((item) => post(item))}
            {!topic.replies && <p className="forum-reply-empty">Be the first to add your take.</p>}
          </section>
          {data.pages > 1 && (
            <nav className="forum-pagination" aria-label="Reply pages">
              <button
                className="btn"
                disabled={page <= 1 || resource.loading}
                onClick={() => setPage((v) => v - 1)}
              >
                Previous
              </button>
              <span>
                Page {data.page} of {data.pages}
              </span>
              <button
                className="btn"
                disabled={page >= data.pages || resource.loading}
                onClick={() => setPage((v) => v + 1)}
              >
                Next
              </button>
            </nav>
          )}
          <section className="forum-reply-box">
            <h2>Join the conversation</h2>
            {user ? (
              <ForumComposer
                key={`${topicId}:${user.id}:${revision}`}
                onSubmit={save}
                busy={busy || Boolean(editing)}
                error={editing ? '' : error}
              />
            ) : (
              <button className="btn btn-primary" onClick={requireUser}>
                Sign in to reply
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
