import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Wifi, WifiOff } from 'lucide-react';
import { ago, itemsOf, send, api, readerRequest } from './api';
import { useReaderResource } from './reader/use-resource';
import { readerContextPath, readerMutation, readerContextKey } from './reader/requests';
import { useApp, useResource } from './state';
import { Avatar, Empty, ErrorNotice } from './components';
export default function Chat({ roomId, roomEvent, enabled = true, live, context }) {
  if (Number.isFinite(context?.expiresAt) && context.expiresAt <= Date.now()) context = null;
  const { user, requireUser, event, connected } = useApp();
  enabled = enabled && (!roomId || !!context);
  const path = roomId
    ? context
      ? readerContextPath(`/api/rooms/${roomId}/chat`, context)
      : null
    : '/api/chat';
  const legacyResource = useResource(!roomId && enabled ? path : null, false);
  const scopedResource = useReaderResource(roomId && enabled ? path : null, { force: true });
  const resource = roomId ? scopedResource : legacyResource;
  const requestController = useRef(null);
  const contextKey = readerContextKey(context);
  useEffect(() => {
    const controller = new AbortController();
    requestController.current = controller;
    return () => controller.abort();
  }, [contextKey, roomId, enabled]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const messages = useRef();
  const follow = useRef(true);
  const [unread, setUnread] = useState(false);
  const currentEvent = roomId ? roomEvent : event;
  const isLive = roomId ? Boolean(live) : connected;
  const identity = `${path}:${user?.id || 'guest'}:${enabled}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  useEffect(() => {
    resource.setData(null);
    setBody('');
    setBusy(false);
    setError('');
    follow.current = true;
    setUnread(false);
    if (enabled) resource.refresh();
  }, [user?.id, enabled, path]);
  useEffect(() => {
    if (enabled && currentEvent?.type === 'snapshot') {
      const requestedIdentity = identityRef.current;
      (roomId
        ? readerRequest(path, { ...context, signal: requestController.current.signal, force: true })
        : api(path)
      )
        .then((data) => {
          if (identityRef.current !== requestedIdentity) return;
          resource.setData((old) => ({
            items: [
              ...new Map(
                [...itemsOf(data), ...itemsOf(old)].map((item) => [item.id, item]),
              ).values(),
            ]
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .slice(-100),
          }));
        })
        .catch(() => {});
    }
    if (
      enabled &&
      currentEvent?.type === 'chat' &&
      (currentEvent.data.roomId || null) === (roomId || null)
    ) {
      resource.setData((old) => ({
        items: [
          ...itemsOf(old).filter((item) => item.id !== currentEvent.data.message.id),
          currentEvent.data.message,
        ].slice(-100),
      }));
    }
  }, [currentEvent, roomId, enabled]);
  useEffect(() => {
    const list = messages.current;
    if (!list) return;
    if (follow.current) list.scrollTop = list.scrollHeight;
    else if (itemsOf(resource.data).length) setUnread(true);
  }, [resource.data]);
  const submit = async (e) => {
    e.preventDefault();
    if (!requireUser() || !enabled) return;
    const requestedIdentity = identityRef.current;
    setError('');
    setBusy(true);
    try {
      const result = await (roomId
        ? readerMutation(path, { body }, 'POST', {
            ...context,
            signal: requestController.current.signal,
          })
        : send(path, { body }));
      if (identityRef.current !== requestedIdentity) return;
      setBody('');
      follow.current = true;
      setUnread(false);
      resource.setData((old) => ({
        items: [
          ...itemsOf(old).filter((item) => item.id !== result.message.id),
          result.message,
        ].slice(-100),
      }));
    } catch (e) {
      if (identityRef.current === requestedIdentity) setError(e.message);
    } finally {
      if (identityRef.current === requestedIdentity) setBusy(false);
    }
  };
  return (
    <section className="chat-panel">
      <div className="chat-heading">
        <MessageCircle size={18} />
        <h2>{roomId ? 'Room chat' : 'The live chat'}</h2>
        <span className={isLive ? 'connection-status' : 'connection-status offline'}>
          {isLive ? <Wifi size={13} /> : <WifiOff size={13} />}{' '}
          {!enabled ? 'Not joined' : isLive ? 'Live' : 'Reconnecting'}
        </span>
      </div>
      <div
        className="chat-messages"
        ref={messages}
        onScroll={(event) => {
          const list = event.currentTarget;
          follow.current = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
          if (follow.current) setUnread(false);
        }}
        aria-label={roomId ? 'Room messages' : 'Community messages'}
        aria-live="polite"
      >
        {(enabled ? itemsOf(resource.data) : []).map((message) => (
          <article
            className={`chat-message ${message.author?.id === user?.id ? 'own' : ''}`}
            key={message.id}
          >
            <Avatar user={message.author || message.user} size="small" />
            <div>
              <div className="chat-byline">
                <strong>{message.author?.name || message.user?.name || 'Member'}</strong>
                <small>{ago(message.createdAt)}</small>
              </div>
              <p>{message.body}</p>
            </div>
          </article>
        ))}
        {!(enabled ? itemsOf(resource.data) : []).length && (
          <Empty
            icon={MessageCircle}
            title={enabled ? 'Say hello. Stay a while.' : 'Join the room to chat.'}
          >
            {roomId
              ? 'A shared story, and a little company.'
              : 'A cozy corner for whatever you’re watching or reading.'}
          </Empty>
        )}
      </div>
      {unread && (
        <button
          className="chat-new-messages"
          onClick={() => {
            follow.current = true;
            setUnread(false);
            messages.current?.scrollTo({ top: messages.current.scrollHeight, behavior: 'smooth' });
          }}
        >
          New messages
        </button>
      )}
      {(error || resource.error) && <ErrorNotice message={error || resource.error} />}
      <form className="chat-compose" onSubmit={submit}>
        <input
          aria-label={roomId ? 'Room message' : 'Chat message'}
          placeholder={
            !enabled
              ? 'Join the room first'
              : user
                ? 'Say something nice…'
                : 'Sign in to join the conversation…'
          }
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          maxLength={2000}
          disabled={!enabled}
        />
        <button aria-label="Send message" type="submit" disabled={busy || !body.trim() || !enabled}>
          <Send size={18} />
        </button>
      </form>
      <span className="chat-footnote">
        Be kind. Mark spoilers. There’s a person on the other side.
      </span>
    </section>
  );
}
