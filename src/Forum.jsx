import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from './collection-router';
import {
  Play,
  BookOpen,
  Layers,
  Gem,
  Compass,
  Newspaper,
  Palette,
  Coffee,
  MessageSquare,
  MessageCircle,
  Plus,
  ArrowRight,
  ArrowLeft,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { forumBoards, forumKinds } from '../shared/forum';
import { useApp, useResource } from './state';
import { useCollection } from './collection-context';
import { ago, send } from './api';
import { ErrorNotice, Modal } from './components';
import CommunityThreads from './CommunityThreads';
import SeriesDiscussions from './SeriesDiscussions';
import './forum.css';

const icons = { Play, BookOpen, Layers, Gem, Compass, Newspaper, Palette, Coffee, MessageSquare };
export function ForumBody({ body, spoiler }) {
  const [revealed, setRevealed] = useState(false);
  return spoiler && !revealed ? (
    <button className="forum-spoiler" onClick={() => setRevealed(true)}>
      <ShieldAlert size={16} /> Spoiler · Reveal post
    </button>
  ) : (
    <p className="forum-post-text">{body}</p>
  );
}
export function ForumComposer({
  initial,
  topic = false,
  board = 'anime',
  onSubmit,
  onCancel,
  busy,
  error,
}) {
  const [body, setBody] = useState(initial?.body || '');
  const [spoiler, setSpoiler] = useState(initial?.spoiler || false);
  const [title, setTitle] = useState('');
  const [channel, setChannel] = useState(board === 'all' ? 'anime' : board);
  const [kind, setKind] = useState('Discussion');
  return (
    <form
      className="forum-composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ body, spoiler, ...(topic ? { title, board: channel, kind } : {}) });
      }}
    >
      {topic && (
        <>
          <div className="forum-form-row">
            <label>
              Channel
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                {forumBoards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Topic type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {forumKinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Topic title
            <input
              autoFocus
              required
              minLength={3}
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give your conversation a clear, spoiler-free title"
            />
          </label>
        </>
      )}
      <label>
        {topic ? 'Your post' : initial ? 'Edit your post' : 'Your reply'}
        <textarea
          aria-label={topic ? 'Your post' : initial ? 'Edit your post' : 'Your reply'}
          disabled={busy}
          required
          maxLength={10000}
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={topic ? 'What would you like to talk about?' : 'Add to the conversation…'}
        />
      </label>
      <div className="forum-form-meta">
        <label className="forum-checkbox">
          <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />{' '}
          Contains spoilers
        </label>
        <small>{body.length.toLocaleString()} / 10,000</small>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="forum-form-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary" disabled={busy || !body.trim()}>
          {busy ? 'Saving…' : topic ? 'Create topic' : initial ? 'Save changes' : 'Post reply'}
        </button>
      </div>
    </form>
  );
}

export default function Forum() {
  const [params, setParams] = useSearchParams();
  const board = forumBoards.some((b) => b.id === params.get('board')) ? params.get('board') : 'all';
  const view = params.get('view') === 'releases' ? 'releases' : 'topics';
  const page = Math.max(1, Math.min(10000, Number(params.get('page')) || 1));
  const q = params.get('q') || '',
    sort = params.get('sort') || 'active';
  const [draft, setDraft] = useState(q),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const navigate = useNavigate(),
    { user, requireUser, event } = useApp();
  const collection = useCollection()?.active ? 'ara-ara' : 'yoru';
  const boards = useResource('/api/forum/boards', false);
  const topics = useResource(
    view === 'topics'
      ? `/api/forum/topics?${new URLSearchParams({ board, q, sort, page: String(page) })}`
      : null,
    false,
  );
  useEffect(() => {
    setDraft(q);
  }, [q]);
  useEffect(() => {
    if (['forum', 'snapshot'].includes(event?.type)) {
      topics.refresh();
      boards.refresh();
    }
  }, [event]);
  useEffect(() => {
    setCreating(false);
    setError('');
  }, [user?.id, collection]);
  const change = (values) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, String(value));
      else next.delete(key);
    }
    setParams(next, { preventScrollReset: true });
  };
  const selected = forumBoards.find((b) => b.id === board);
  const create = async (input) => {
    if (!requireUser() || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await send('/api/forum/topics', { ...input, collection });
      setCreating(false);
      navigate(`/community/forum/${result.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="forum-hub" aria-label="Community forums">
      <div className="forum-heading">
        <div>
          <span className="section-kicker">FIND YOUR PEOPLE</span>
          <h2>Forums</h2>
          <p>One good story starts another conversation.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            if (requireUser()) setCreating(true);
          }}
        >
          <Plus size={16} /> New topic
        </button>
      </div>
      <nav className="forum-boards" aria-label="Forum channels">
        {forumBoards.map((b) => {
          const Icon = icons[b.icon];
          return (
            <button
              key={b.id}
              className={`forum-board tone-${b.tone} ${board === b.id ? 'active' : ''}`}
              aria-pressed={board === b.id}
              onClick={() => change({ board: b.id })}
            >
              <span className="forum-board-icon">
                <Icon size={21} />
              </span>
              <span>
                <strong>{b.name}</strong>
                <small>{b.description}</small>
                <em>{boards.data?.items.find((x) => x.id === b.id)?.topics ?? '—'} topics</em>
              </span>
              <ArrowRight size={15} />
            </button>
          );
        })}
      </nav>
      {boards.error && <ErrorNotice message={boards.error} retry={boards.refresh} />}
      <div className="forum-list-heading">
        <div>
          {selected && (
            <button className="text-link" onClick={() => change({ board: null })}>
              <ArrowLeft size={14} /> All channels
            </button>
          )}
          <h3>{selected?.name || 'All channels'}</h3>
        </div>
        <div className="segmented" role="group" aria-label="Forum view">
          <button
            aria-pressed={view === 'topics'}
            className={view === 'topics' ? 'active' : ''}
            onClick={() => change({ view: null })}
          >
            Topics
          </button>
          <button
            aria-pressed={view === 'releases'}
            className={view === 'releases' ? 'active' : ''}
            onClick={() => change({ view: 'releases' })}
          >
            Episode & chapter threads
          </button>
        </div>
      </div>
      {view === 'releases' ? (
        <>
          <SeriesDiscussions
            key={board}
            initialCategory={['anime', 'manga', 'manhwa'].includes(board) ? board : 'anime'}
          />
          <CommunityThreads
            key={`recent-${board}`}
            initialCategory={['anime', 'manga', 'manhwa'].includes(board) ? board : 'anime'}
          />
        </>
      ) : (
        <>
          <div className="forum-tools">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                change({ q: draft.trim() });
              }}
            >
              <Search size={16} />
              <input
                type="search"
                aria-label="Search forum topics"
                value={draft}
                maxLength={100}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Search topic titles…"
              />
              <button className="btn btn-subtle">Search</button>
            </form>
            <label className="sr-only" htmlFor="forum-sort">
              Sort topics
            </label>
            <select id="forum-sort" value={sort} onChange={(e) => change({ sort: e.target.value })}>
              <option value="active">Recently active</option>
              <option value="newest">Newest topics</option>
              <option value="replies">Most replies</option>
            </select>
          </div>
          {topics.error && <ErrorNotice message={topics.error} retry={topics.refresh} />}
          {topics.loading && <p role="status">Loading topics…</p>}
          <div className="forum-topic-list" aria-busy={topics.loading}>
            {(topics.data?.items || []).map((t) => (
              <article className="forum-topic-row" key={t.id}>
                <span className="forum-topic-symbol">
                  <MessageCircle size={20} />
                </span>
                <div>
                  <div className="forum-topic-labels">
                    <span>{forumBoards.find((b) => b.id === t.board)?.name}</span>
                    <span>{t.kind}</span>
                    {t.spoiler && (
                      <span>
                        <ShieldAlert size={12} /> Spoilers
                      </span>
                    )}
                  </div>
                  <Link to={`/community/forum/${t.id}`}>
                    <h4>{t.title}</h4>
                  </Link>
                  <small>
                    Started by {t.author.name} · {ago(t.createdAt)}
                  </small>
                </div>
                <div className="forum-topic-activity">
                  <strong>{t.replies}</strong>
                  <span>{t.replies === 1 ? 'reply' : 'replies'}</span>
                  <small>{ago(t.latest)}</small>
                </div>
              </article>
            ))}
          </div>
          {!topics.loading && !topics.error && !topics.data?.items?.length && (
            <div className="forum-empty">
              <MessageSquare size={28} />
              <h4>
                {q
                  ? 'No topics match your search.'
                  : `Start something in ${selected?.name || 'the community'}.`}
              </h4>
              <p>
                {q
                  ? 'Try another title or channel.'
                  : selected?.id === 'figures'
                    ? 'Show off your shelf, ask about your first figure, or share a collecting tip.'
                    : 'Share a theory, ask a question, or start a conversation.'}
              </p>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  if (requireUser()) setCreating(true);
                }}
              >
                Start a topic <Plus size={14} />
              </button>
            </div>
          )}
          {topics.data?.pages > 1 && (
            <nav className="forum-pagination" aria-label="Topic pages">
              <button
                className="btn"
                disabled={page <= 1}
                onClick={() => change({ page: page - 1 })}
              >
                Previous
              </button>
              <span>
                Page {page} of {topics.data.pages}
              </span>
              <button
                className="btn"
                disabled={page >= topics.data.pages}
                onClick={() => change({ page: page + 1 })}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
      {creating && (
        <Modal
          title="Start a topic"
          close={() => {
            if (!busy) setCreating(false);
          }}
        >
          <h2>Start a topic</h2>
          <p className="muted">Keep titles spoiler-free. Be kind and credit creators.</p>
          <ForumComposer
            topic
            board={board}
            onSubmit={create}
            onCancel={() => setCreating(false)}
            busy={busy}
            error={error}
          />
        </Modal>
      )}
    </section>
  );
}
