import React, { useEffect, useRef, useState } from 'react';
import { Link } from './collection-router';
import {
  ArrowUp,
  ThumbsDown,
  ThumbsUp,
  Smile,
  Image,
  Sparkles,
  MessageCircle,
  Reply,
  Send,
  ShieldAlert,
  Star,
} from 'lucide-react';
import { ago, itemsOf } from './api';
import { useApp } from './state';
import { Avatar, Button, Empty, ErrorNotice, Loading } from './components';
import { CommentBody, CommentMediaPicker } from './CommentMedia';
import { gifToken, emoteToken, commentMediaError } from '../shared/comment-media';
import './discussion.css';
import { useReaderResource } from './reader/use-resource';
import { readerContextKey, readerMutation, readerSourceAllowed } from './reader/requests';
import { useReaderSelection } from './useCatalogPreferences';
import { discussionReference } from '../shared/native-social-contract';
function Spoiler({ hidden, children }) {
  const [revealed, setRevealed] = useState(false);
  return hidden && !revealed ? (
    <button className="spoiler" onClick={() => setRevealed(true)}>
      <ShieldAlert size={15} />
      Spoiler · click to reveal
    </button>
  ) : (
    <div className="comment-body">{children}</div>
  );
}
export default function Discussion({ mediaId, media, unit = 1, edition, communityLink = true }) {
  const { user, requireUser, event, notify } = useApp();
  const selection = useReaderSelection();
  const context = selection?.ready ? selection.context : null;
  const contextKey = readerContextKey(context);
  const reference = discussionReference(mediaId, unit, edition);
  const allowed =
    !!context &&
    !!reference &&
    (!media?.sourceRef || readerSourceAllowed(media.sourceRef, context));
  const resource = useReaderResource(
    allowed
      ? `/api/comments/${mediaId}?${new URLSearchParams({ unit: String(unit), ...(edition ? { edition } : {}) })}`
      : null,
    { force: true },
  );
  const controller = useRef(null);
  const [body, setBody] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [sort, setSort] = useState('top');
  const [picker, setPicker] = useState(null);
  const [gif, setGif] = useState('');
  const [emotes, setEmotes] = useState({});
  const [voting, setVoting] = useState({});
  const textarea = useRef(null);
  const scope = useRef('');
  scope.current = `${contextKey}:${mediaId}:${unit}:${edition || ''}`;
  useEffect(() => {
    if (
      event?.type === 'snapshot' ||
      (event?.type === 'comments' &&
        event.data.mediaId === mediaId &&
        event.data.unit === Number(unit) &&
        (event.data.editionId || null) === (edition || null))
    )
      resource.refresh();
  }, [event, mediaId, unit, edition]);
  useEffect(() => {
    resource.refresh();
  }, [user?.id]);
  useEffect(() => {
    const pending = new AbortController();
    controller.current = pending;
    setReplyTo(null);
    setError('');
    setBody('');
    setGif('');
    setEmotes({});
    setSpoiler(false);
    setPicker(null);
    setBusy(false);
    setVoting({});
    return () => {
      pending.abort();
    };
  }, [unit, mediaId, edition, contextKey]);
  const insert = (value, emote) => {
    const field = textarea.current;
    const start = field?.selectionStart ?? body.length;
    const end = field?.selectionEnd ?? start;
    const text = `${body.slice(0, start)}${value}${body.slice(end)}`;
    if (text.length > 4000) {
      setError('Keep your comment under 4,000 characters.');
      return;
    }
    setBody(text);
    if (emote) setEmotes((previous) => ({ ...previous, [emote.name]: emote }));
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + value.length, start + value.length);
    });
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!requireUser() || !allowed) return;
    if (busy) return;
    const encoded = body
      .trim()
      .replace(/:([A-Za-z0-9_]{1,60}):/g, (match, name) =>
        Object.hasOwn(emotes, name) ? emoteToken(emotes[name]) : match,
      );
    const content = [encoded, gif && gifToken(gif)].filter(Boolean).join('\n');
    const invalid = commentMediaError(content);
    if (!content || content.length > 5000 || invalid) {
      setError(invalid || 'Add a comment or GIF, up to 5,000 characters.');
      return;
    }
    const submissionScope = scope.current;
    setError('');
    setBusy(true);
    try {
      await readerMutation(
        `/api/comments/${mediaId}`,
        {
          body: content,
          unit: Number(unit),
          parentId: replyTo?.id || null,
          spoiler,
          ...(edition ? { edition } : {}),
        },
        'POST',
        { ...context, signal: controller.current?.signal },
      );
      if (submissionScope !== scope.current) return;
      setBody('');
      setGif('');
      setEmotes({});
      setPicker(null);
      setSpoiler(false);
      setReplyTo(null);
      resource.refresh();
    } catch (e) {
      if (submissionScope === scope.current) setError(e.message);
    } finally {
      if (submissionScope === scope.current) setBusy(false);
    }
  };
  const vote = async (id, value) => {
    if (!requireUser() || !allowed) return;
    const requestedScope = scope.current;
    if (voting[id]) return;
    setVoting((previous) => ({ ...previous, [id]: true }));
    try {
      await readerMutation(`/api/comments/${id}/vote`, { value }, 'POST', {
        ...context,
        signal: controller.current?.signal,
      });
      if (scope.current === requestedScope) resource.refresh();
    } catch (e) {
      if (scope.current === requestedScope) notify(e.message, 'error');
    } finally {
      if (scope.current === requestedScope) setVoting((previous) => ({ ...previous, [id]: false }));
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
        <Spoiler hidden={comment.spoiler}>
          <CommentBody body={comment.body} />
        </Spoiler>
        <div className="comment-actions">
          <span className="vote-controls">
            <button
              aria-label={`Like comment by ${comment.author?.name || comment.user?.name || comment.userName || 'member'}`}
              title="Like"
              disabled={voting[comment.id]}
              aria-pressed={comment.viewerVote === 1}
              className={comment.viewerVote === 1 ? 'voted' : ''}
              onClick={() => vote(comment.id, comment.viewerVote === 1 ? 0 : 1)}
            >
              <ThumbsUp size={15} />
              <span>{comment.likes || 0}</span>
            </button>
            <button
              aria-label="Dislike comment"
              title="Dislike"
              disabled={voting[comment.id]}
              aria-pressed={comment.viewerVote === -1}
              className={comment.viewerVote === -1 ? 'voted' : ''}
              onClick={() => vote(comment.id, comment.viewerVote === -1 ? 0 : -1)}
            >
              <ThumbsDown size={15} />
              <span>{comment.dislikes || 0}</span>
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
      {!reference && (
        <ErrorNotice message="Choose an exact chapter edition to open its discussion." />
      )}
      {context && !allowed && reference && (
        <ErrorNotice message="This source is disabled for this section." />
      )}
      {communityLink && !edition && Number(unit) > 0 && (
        <Link className="text-link discussion-community-link" to={`/community/${mediaId}/${unit}`}>
          Open this thread in Community →
        </Link>
      )}
      <form className="comment-compose" onSubmit={submit}>
        <div className="comment-compose-identity">
          <Avatar user={user || { name: 'Guest' }} />
          {user ? (
            <strong>{user.name}</strong>
          ) : (
            <button type="button" onClick={requireUser}>
              Sign in to join the discussion
            </button>
          )}
        </div>
        {replyTo && (
          <div className="replying-to">
            Replying to {replyTo.author?.name || replyTo.user?.name || replyTo.userName || 'member'}
            <button type="button" disabled={busy} onClick={() => setReplyTo(null)}>
              Cancel reply
            </button>
          </div>
        )}
        <textarea
          id="discussion-body"
          ref={textarea}
          aria-label="Discussion comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            user
              ? 'What a moment. What did you think?'
              : 'Sign in and add your take to the conversation…'
          }
          disabled={!user || busy || !allowed}
          maxLength={4000}
        />
        {gif && (
          <div className="comment-gif-preview">
            <CommentBody body={gifToken(gif)} />
            <button
              type="button"
              disabled={busy}
              aria-label="Remove GIF"
              onClick={() => setGif('')}
            >
              Remove GIF ×
            </button>
          </div>
        )}
        {picker && user && !busy && (
          <CommentMediaPicker
            tab={picker}
            onInsert={insert}
            onGif={setGif}
            close={() => setPicker(null)}
          />
        )}
        <div className="compose-footer">
          <div className="comment-media-tools" role="group" aria-label="Add comment media">
            {[
              ['emoji', Smile, 'Emoji'],
              ['emotes', Sparkles, 'Emotes'],
              ['gif', Image, 'GIF'],
            ].map(([key, Icon, label]) => (
              <button
                key={key}
                type="button"
                aria-label={`Add ${label}`}
                aria-expanded={picker === key}
                disabled={busy}
                onClick={() => {
                  if (requireUser()) setPicker(picker === key ? null : key);
                }}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={spoiler}
              disabled={busy}
              onChange={(e) => setSpoiler(e.target.checked)}
            />
            Contains spoilers
          </label>
          <Button
            busy={busy}
            disabled={!allowed}
            type={user ? 'submit' : 'button'}
            onClick={user ? undefined : requireUser}
            variant="primary"
          >
            <Send size={15} />
            {!user ? 'Sign in to comment' : replyTo ? 'Post reply' : 'Post comment'}
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
  const resource = useReaderResource(`/api/reviews/${mediaId}`, { force: true });
  const context = resource.context;
  const contextKey = readerContextKey(context);
  const identity = useRef('');
  identity.current = `${contextKey}:${mediaId}`;
  const controller = useRef(null);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const pending = new AbortController();
    controller.current = pending;
    setWriting(false);
    setBusy(false);
    setError('');
    return () => pending.abort();
  }, [contextKey, mediaId]);
  useEffect(() => {
    if (event?.type === 'snapshot' || (event?.type === 'reviews' && event.data.mediaId === mediaId))
      resource.refresh();
  }, [event, mediaId]);
  const submit = async (e) => {
    e.preventDefault();
    if (!requireUser() || !context || resource.error) return;
    const requestedIdentity = identity.current;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await readerMutation(
        `/api/reviews/${mediaId}`,
        {
          title: form.get('title'),
          body: form.get('body'),
          rating: Number(form.get('rating')),
          spoiler: form.get('spoiler') === 'on',
        },
        'POST',
        { ...context, signal: controller.current?.signal },
      );
      if (identity.current !== requestedIdentity) return;
      setWriting(false);
      resource.refresh();
    } catch (e) {
      if (identity.current === requestedIdentity) setError(e.message);
    } finally {
      if (identity.current === requestedIdentity) setBusy(false);
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
          disabled={!context || !!resource.error}
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
