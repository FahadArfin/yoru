import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Hash, Plus, Search, Send, Globe, ArrowDown, X } from 'lucide-react';
import { api, ago } from './api';
import { useApp } from './state';
import { Avatar, ErrorNotice } from './components';
import './public-channels.css';

export default function PublicChannels() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('channel') || 'general';
  const { requireUser } = useApp();
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState('');
  const [saving, setSaving] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const listController = useRef(null);
  function choose(id) {
    setBrowserOpen(false);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('view', 'chat');
      next.set('channel', id);
      return next;
    });
  }
  useEffect(() => {
    const controller = new AbortController();
    listController.current = controller;
    setLoading(true);
    setError('');
    const timer = setTimeout(
      () => {
        api(`/api/channels?q=${encodeURIComponent(search)}`, { signal: controller.signal })
          .then((data) => {
            if (!controller.signal.aborted) {
              setItems(data.items);
              setCursor(data.nextCursor);
            }
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      search ? 180 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, revision]);
  async function loadMore() {
    const controller = listController.current;
    setLoading(true);
    try {
      const data = await api(
        `/api/channels?q=${encodeURIComponent(search)}&after=${encodeURIComponent(cursor)}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setItems((old) => [...new Map([...old, ...data.items].map((x) => [x.id, x])).values()]);
        setCursor(data.nextCursor);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  async function create(e) {
    e.preventDefault();
    if (!requireUser() || saving) return;
    setSaving(true);
    setCreateError('');
    try {
      const result = await api('/api/channels', {
        method: 'POST',
        body: JSON.stringify({ name, description }),
      });
      setCreating(false);
      setName('');
      setDescription('');
      setSearch('');
      setRevision((x) => x + 1);
      choose(result.channel.id);
    } catch (e) {
      setCreateError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      className={`public-channels ${browserOpen ? 'browser-open' : ''}`}
      aria-label="Public live chat"
    >
      <button
        className="channel-browser-toggle"
        aria-expanded={browserOpen}
        aria-controls="public-channel-browser"
        onClick={() => setBrowserOpen((value) => !value)}
      >
        <Hash size={17} />
        {browserOpen ? 'Back to conversation' : 'Browse channels'}
      </button>
      <aside id="public-channel-browser" className="channel-browser" aria-label="Channel browser">
        <div className="channel-browser-heading">
          <div>
            <h2>Channels</h2>
            <span>
              <Globe size={13} /> Open to everyone
            </span>
          </div>
          <button
            className="channel-create-button"
            aria-label="Create channel"
            onClick={() => {
              if (requireUser()) {
                setCreating(true);
                setCreateError('');
              }
            }}
          >
            <Plus size={19} />
          </button>
        </div>
        <label className="channel-search">
          <Search size={16} />
          <input
            aria-label="Search channels"
            placeholder="Find a channel…"
            value={search}
            maxLength={80}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {creating && (
          <form
            className="channel-create-form"
            onSubmit={create}
            aria-label="Create public channel"
          >
            <div className="channel-form-heading">
              <h3>Create a channel</h3>
              <button
                type="button"
                aria-label="Cancel channel creation"
                onClick={() => setCreating(false)}
              >
                <X size={16} />
              </button>
            </div>
            <label>
              Name
              <input
                autoFocus
                required
                minLength={3}
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Weekend watchlist"
              />
            </label>
            <label>
              Description
              <textarea
                maxLength={240}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What will you talk about?"
                rows={3}
              />
            </label>
            <small>Always public. Anyone can find this channel and read its messages.</small>
            {createError && <ErrorNotice message={createError} />}
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create public channel'}
            </button>
          </form>
        )}
        {error && <ErrorNotice message={error} retry={() => setRevision((x) => x + 1)} />}
        <nav className="channel-list" aria-label="Public channels">
          {items.map((channel) => (
            <button
              key={channel.id}
              aria-current={channel.id === selected ? 'true' : undefined}
              onClick={() => choose(channel.id)}
            >
              <Hash size={18} />
              <span>
                <strong>{channel.name}</strong>
                {channel.description && <small>{channel.description}</small>}
              </span>
            </button>
          ))}
          {loading && <p role="status">Loading channels…</p>}
          {!loading && !error && !items.length && (
            <p>No channels found. Try another name or create one.</p>
          )}
          {cursor && (
            <button className="channel-more" disabled={loading} onClick={loadMore}>
              More channels
            </button>
          )}
        </nav>
      </aside>
      <ChannelConversation key={selected} channelId={selected} />
    </section>
  );
}

function ChannelConversation({ channelId }) {
  const { user, requireUser } = useApp();
  const path = `/api/channels/${encodeURIComponent(channelId)}/messages`;
  const [channel, setChannel] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [older, setOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [unread, setUnread] = useState(false);
  const [revision, setRevision] = useState(0);
  const list = useRef(null),
    follow = useRef(true),
    anchor = useRef(null),
    cursor = useRef(null),
    lifetime = useRef(null);
  function merge(rows) {
    if (!rows.length) return;
    setItems((old) =>
      [...new Map([...old, ...rows].map((x) => [x.id, x])).values()].sort(
        (a, b) => a.sequence - b.sequence,
      ),
    );
    if (rows.length && !follow.current) setUnread(true);
  }
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    let timer,
      running = false;
    async function poll() {
      if (running || controller.signal.aborted) return;
      clearTimeout(timer);
      if (document.hidden) {
        timer = setTimeout(poll, 3000);
        return;
      }
      running = true;
      let delay = 3000;
      try {
        const data = await api(
          `${path}${cursor.current ? `?after=${encodeURIComponent(cursor.current)}` : ''}`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) },
        );
        if (controller.signal.aborted) return;
        setChannel(data.channel);
        setError('');
        const initial = !cursor.current;
        if (initial) setHasOlder(data.hasMore);
        merge(data.items);
        if (data.items.length) cursor.current = data.items.at(-1).id;
        if (data.hasMore && !initial) delay = 100;
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e.message);
          delay = 8000;
        }
      } finally {
        running = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(poll, delay);
        }
      }
    }
    const visible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener('visibilitychange', visible);
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [path, revision, user?.id]);
  useEffect(() => {
    setBody('');
    setBusy(false);
    setSendError('');
    setOlder(false);
  }, [user?.id]);
  useLayoutEffect(() => {
    if (!list.current) return;
    if (anchor.current) {
      list.current.scrollTop =
        anchor.current.top + list.current.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (follow.current) list.current.scrollTop = list.current.scrollHeight;
  }, [items]);
  async function history() {
    const controller = lifetime.current;
    setOlder(true);
    try {
      const data = await api(`${path}?before=${encodeURIComponent(items[0].id)}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      anchor.current = { height: list.current.scrollHeight, top: list.current.scrollTop };
      setItems((old) =>
        [...new Map([...data.items, ...old].map((x) => [x.id, x])).values()].sort(
          (a, b) => a.sequence - b.sequence,
        ),
      );
      setHasOlder(data.hasMore);
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (!controller.signal.aborted) setOlder(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    if (!requireUser() || busy || !body.trim()) return;
    const controller = lifetime.current;
    setBusy(true);
    setSendError('');
    try {
      const data = await api(path, {
        method: 'POST',
        body: JSON.stringify({ body }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setBody('');
      follow.current = true;
      setUnread(false);
      merge([data.message]);
    } catch (e) {
      if (!controller.signal.aborted) setSendError(e.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="channel-conversation" aria-label="Channel conversation">
      <header className="channel-conversation-heading">
        <Hash size={24} />
        <div>
          <h2>{channel?.name || 'Live chat'}</h2>
          <p>{channel?.description || 'Public community channel'}</p>
        </div>
        <span>
          <Globe size={14} /> Public
        </span>
      </header>
      {error && <ErrorNotice message={error} retry={() => setRevision((x) => x + 1)} />}
      <div
        className="channel-messages"
        ref={list}
        aria-label="Channel messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
          if (follow.current) setUnread(false);
        }}
      >
        {hasOlder && items.length > 0 && (
          <button className="channel-history" onClick={history} disabled={older}>
            {older ? 'Loading…' : 'Load older messages'}
          </button>
        )}
        {loading && <p role="status">Loading conversation…</p>}
        {!loading && !error && !items.length && (
          <div className="channel-welcome">
            <Hash size={36} />
            <h3>Start the conversation</h3>
            <p>
              This is the beginning of #{channel?.name}. Say hello or share what’s on your mind.
            </p>
          </div>
        )}
        {items.map((message) => (
          <article
            className={`channel-message ${message.author.id === user?.id ? 'own' : ''}`}
            key={message.id}
          >
            <Avatar user={message.author} size="small" />
            <div>
              <div className="channel-byline">
                <strong>{message.author.name}</strong>
                <time
                  dateTime={message.createdAt}
                  title={new Date(message.createdAt).toLocaleString()}
                >
                  {ago(message.createdAt)}
                </time>
              </div>
              <p>{message.body}</p>
            </div>
          </article>
        ))}
      </div>
      {unread && (
        <button
          className="channel-unread"
          onClick={() => {
            follow.current = true;
            setUnread(false);
            list.current.scrollTop = list.current.scrollHeight;
          }}
        >
          <ArrowDown size={15} /> New messages
        </button>
      )}
      {sendError && <ErrorNotice message={sendError} />}
      {user ? (
        <form className="channel-compose" onSubmit={submit}>
          <textarea
            aria-label="Channel message"
            placeholder={`Message #${channel?.name || 'channel'}…`}
            maxLength={2000}
            required
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!channel}
          />
          <button
            className="btn btn-primary"
            aria-label="Send message"
            disabled={busy || !body.trim() || !channel}
          >
            <Send size={18} />
            <span>{busy ? 'Sending…' : 'Send'}</span>
          </button>
        </form>
      ) : (
        <div className="channel-sign-in">
          <span>Everyone can read. Sign in to join the conversation.</span>
          <button className="btn btn-primary" onClick={requireUser}>
            Sign in to chat
          </button>
        </div>
      )}
      <p className="channel-footnote">
        Public conversation · Be kind and keep spoilers out of channel names.
      </p>
    </section>
  );
}
