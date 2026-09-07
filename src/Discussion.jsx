import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, MessageCircle, Reply, Send, ShieldAlert, Star } from 'lucide-react';
import { ago, itemsOf, send } from './api';
import { useApp, useResource } from './state';
import { Avatar, Button, Empty, ErrorNotice, Loading } from './components';
function Spoiler({ hidden, children }) {
  const [revealed, setRevealed] = useState(false);
  return hidden && !revealed ? (
    <button className="spoiler" onClick={() => setRevealed(true)}>
      <ShieldAlert size={15} />
      Spoiler · click to reveal
    </button>
  ) : (
    <p className="comment-body">{children}</p>
  );
}
export default function Discussion({ mediaId, unit = 1 }) {
  const { user, requireUser, event, notify } = useApp();
  const resource = useResource(`/api/comments/${mediaId}?unit=${unit}`, false);
  const [body, setBody] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [sort, setSort] = useState('top');
  useEffect(() => {
    if (
      event?.type === 'comments' &&
      event.data.mediaId === mediaId &&
      event.data.unit === Number(unit)
    )
      resource.refresh();
  }, [event, mediaId]);
  useEffect(() => {
    setReplyTo(null);
    setError('');
  }, [unit, mediaId]);
  const submit = async (e) => {
    e.preventDefault();
    if (!requireUser()) return;
    setError('');
    setBusy(true);
    try {
      await send(`/api/comments/${mediaId}`, {
        body,
        unit: Number(unit),
        parentId: replyTo?.id || null,
        spoiler,
      });
      setBody('');
      setSpoiler(false);
      setReplyTo(null);
      resource.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const vote = async (id, value) => {
    if (!requireUser()) return;
    try {
      await send(`/api/comments/${id}/vote`, { value });
      resource.refresh();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const all = itemsOf(resource.data);
  const roots = all
    .filter((c) => !c.parentId)
    .sort((a, b) =>
      sort === 'top'
        ? (b.score || b.votes || 0) - (a.score || a.votes || 0)
        : new Date(b.createdAt) - new Date(a.createdAt),
    );
  const render = (comment, depth = 0) => (
    <article className={`comment ${depth ? 'comment-reply' : ''}`} key={comment.id}>
      <Avatar user={comment.author || comment.user || { name: comment.userName || comment.name }} />
      <div className="comment-content">
        <div className="comment-byline">
          <strong>
            {comment.author?.name ||
              comment.user?.name ||
              comment.userName ||
              comment.name ||
              'Member'}
          </strong>
          <span>{ago(comment.createdAt)}</span>
        </div>
        <Spoiler hidden={comment.spoiler}>{comment.body}</Spoiler>
        <div className="comment-actions">
          <span className="vote-controls">
            <button
              aria-label={`Upvote comment by ${comment.author?.name || comment.user?.name || comment.userName || 'member'}`}
              aria-pressed={comment.viewerVote === 1}
              className={comment.viewerVote === 1 ? 'voted' : ''}
              onClick={() => vote(comment.id, comment.viewerVote === 1 ? 0 : 1)}
            >
              <ArrowUp size={15} />
            </button>
            <strong>{comment.score || 0}</strong>
            <button
              aria-label="Downvote comment"
              aria-pressed={comment.viewerVote === -1}
              className={comment.viewerVote === -1 ? 'voted' : ''}
              onClick={() => vote(comment.id, comment.viewerVote === -1 ? 0 : -1)}
            >
              <ArrowDown size={15} />
            </button>
          </span>
          {depth < 4 && (
            <button
              onClick={() => {
                if (requireUser()) {
                  setReplyTo(comment);
                  document.getElementById('discussion-body')?.focus();
                }
              }}
            >
              <Reply size={14} />
              Reply
            </button>
          )}
        </div>
        {depth < 6 &&
          (comment.replies || all.filter((c) => c.parentId === comment.id)).map((c) =>
            render(c, depth + 1),
          )}
      </div>
    </article>
  );
  return (
    <section className="discussion">
      <div className="discussion-heading">
        <h2>
          <MessageCircle size={20} />
          The discussion <span>{all.length}</span>
        </h2>
        <div className="segmented">
          <button className={sort === 'top' ? 'active' : ''} onClick={() => setSort('top')}>
            Top
          </button>
          <button className={sort === 'new' ? 'active' : ''} onClick={() => setSort('new')}>
            Newest
          </button>
        </div>
      </div>
      <p className="muted discussion-subtitle">
        For this episode or chapter only. Keep future plot twists under wraps.
      </p>
      <form className="comment-compose" onSubmit={submit}>
        {replyTo && (
          <div className="replying-to">
            Replying to {replyTo.author?.name || replyTo.user?.name || replyTo.userName || 'member'}
            <button type="button" onClick={() => setReplyTo(null)}>
              Cancel reply
            </button>
          </div>
        )}
        <textarea
          id="discussion-body"
          aria-label="Discussion comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            user
              ? 'What a moment. What did you think?'
              : 'Sign in and add your take to the conversation…'
          }
          required
          maxLength={4000}
        />
        <div className="compose-footer">
          <label className="check-label">
            <input
              type="checkbox"
              checked={spoiler}
              onChange={(e) => setSpoiler(e.target.checked)}
            />
            Contains spoilers
          </label>
          <Button busy={busy} type="submit" variant="primary">
            <Send size={15} />
            {replyTo ? 'Post reply' : 'Post comment'}
          </Button>
        </div>
        {error && <ErrorNotice message={error} />}
      </form>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorNotice message={resource.error} retry={resource.refresh} />
      ) : roots.length ? (
        <div className="comment-list">{roots.map((c) => render(c))}</div>
      ) : (
        <Empty icon={MessageCircle} title="The first take is yours.">
          Big theories, tiny details, or just “that was incredible.” Start the discussion.
        </Empty>
      )}
    </section>
  );
}
export function Reviews({ mediaId }) {
  const { requireUser, event } = useApp();
  const resource = useResource(`/api/reviews/${mediaId}`, false);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (event?.type === 'reviews' && event.data.mediaId === mediaId) resource.refresh();
  }, [event, mediaId]);
  const submit = async (e) => {
    e.preventDefault();
    if (!requireUser()) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await send(`/api/reviews/${mediaId}`, {
        title: form.get('title'),
        body: form.get('body'),
        rating: Number(form.get('rating')),
        spoiler: form.get('spoiler') === 'on',
      });
      setWriting(false);
      resource.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="reviews">
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE BIG PICTURE</span>
          <h2>Community reviews</h2>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            if (requireUser()) setWriting(!writing);
          }}
        >
          <Star size={16} />
          {writing ? 'Cancel review' : 'Write a review'}
        </Button>
      </div>
      <p className="muted">
        Thoughts on the whole story. Episode and chapter conversations have their own space.
      </p>
      {writing && (
        <form className="panel form-stack review-form" onSubmit={submit}>
          <label>
            Your rating
            <select aria-label="Your rating" name="rating" defaultValue="8">
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1} / 10
                </option>
              ))}
            </select>
          </label>
          <label>
            Review title
            <input name="title" required maxLength={120} placeholder="Give your take a title" />
          </label>
          <label>
            Your review
            <textarea
              name="body"
              required
              minLength={10}
              maxLength={5000}
              placeholder="What stayed with you?"
            />
          </label>
          <label className="check-label">
            <input type="checkbox" name="spoiler" />
            Contains spoilers
          </label>
          {error && <ErrorNotice message={error} />}
          <Button busy={busy} type="submit">
            Publish review
            <ArrowUp size={16} />
          </Button>
        </form>
      )}
      {resource.error && <ErrorNotice message={resource.error} retry={resource.refresh} />}
      <div className="review-list">
        {itemsOf(resource.data).map((review) => (
          <article className="review-card" key={review.id}>
            <div className="review-top">
              <Avatar
                user={review.author || review.user || { name: review.userName || review.name }}
              />
              <div>
                <strong>
                  {review.author?.name || review.user?.name || review.userName || review.name}
                </strong>
                <small>{ago(review.createdAt)}</small>
              </div>
              <span className="review-score">
                <Star size={14} fill="currentColor" />
                {review.rating}
                <small>/10</small>
              </span>
            </div>
            <h3>{review.title}</h3>
            <Spoiler hidden={review.spoiler}>{review.body}</Spoiler>
          </article>
        ))}
      </div>
      {!resource.loading && !itemsOf(resource.data).length && !writing && (
        <Empty icon={Star} title="A story worth talking about.">
          Be the first to write a review and help someone find their next favorite.
        </Empty>
      )}
    </section>
  );
}
