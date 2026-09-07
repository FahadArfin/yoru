import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Wifi, WifiOff } from 'lucide-react';
import { ago, itemsOf, send } from './api';
import { useApp, useResource } from './state';
import { Avatar, Empty, ErrorNotice } from './components';
export default function Chat({ roomId, roomEvent, enabled = true, live }) {
  const { user, requireUser, event, connected } = useApp();
  const path = roomId ? `/api/rooms/${roomId}/chat` : '/api/chat';
  const resource = useResource(enabled ? path : null, false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef();
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
    if (enabled) resource.refresh();
  }, [user?.id, enabled, path]);
  useEffect(() => {
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
    end.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  }, [resource.data]);
  const submit = async (e) => {
    e.preventDefault();
    if (!requireUser() || !enabled) return;
    const requestedIdentity = identityRef.current;
    setError('');
    setBusy(true);
    try {
      const result = await send(path, { body });
      if (identityRef.current !== requestedIdentity) return;
      setBody('');
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
        <div ref={end} />
      </div>
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
