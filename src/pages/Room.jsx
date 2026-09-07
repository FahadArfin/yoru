import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Crown,
  DoorOpen,
  ExternalLink,
  Link2,
  Lock,
  Pause,
  Play,
  Plus,
  Users,
} from 'lucide-react';
import { bannerOf, send, titleOf } from '../api';
import { useApp, useResource } from '../state';
import { Avatar, Badge, Button, Empty, ErrorNotice, Loading } from '../components';
import Chat from '../Chat';
import { ExternalPlayer, SourceForm, SyncedVideo } from '../Playback';
export default function Room() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const invite = params.get('invite');
  const navigate = useNavigate();
  const { user, requireUser, notify } = useApp();
  const resource = useResource(
    `/api/rooms/${id}${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`,
    false,
  );
  const room = resource.data?.room;
  const [roomEvent, setRoomEvent] = useState(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unitDraft, setUnitDraft] = useState(1);
  const [positionDraft, setPositionDraft] = useState(0);
  const joined = Boolean(room?.joined && user);
  const host = Boolean(user && room?.hostId === user.id);
  const [live, setLive] = useState(false);
  const identity = `${id}:${user?.id || 'guest'}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  useEffect(() => {
    resource.setData(null);
    resource.refresh();
    setRoomEvent(null);
    setSourceOpen(false);
    setBusy(false);
    setError('');
  }, [id, user?.id]);
  useEffect(() => {
    if (room) {
      setUnitDraft(room.unit);
      setPositionDraft(Math.floor(room.position));
    }
  }, [room?.unit, room?.version]);
  useEffect(() => {
    if (!joined) return;
    let active = true;
    const stream = new EventSource(`/api/events?roomId=${id}`);
    const handle = (e) => {
      if (!active) return;
      try {
        const data = JSON.parse(e.data);
        setRoomEvent({ type: e.type, data, time: Date.now() });
        if (e.type === 'left') {
          stream.close();
          setLive(false);
          resource.setData((old) => ({ room: { ...old?.room, joined: false, sourceUrl: '' } }));
          resource.refresh();
        } else if (data.room === null) {
          notify('The room has closed.');
          navigate('/rooms');
        } else if (data.room)
          resource.setData((old) =>
            old?.room?.version > data.room.version ? old : { room: { ...old?.room, ...data.room } },
          );
      } catch {}
    };
    stream.addEventListener('snapshot', handle);
    stream.addEventListener('room', handle);
    stream.addEventListener('chat', handle);
    stream.addEventListener('left', handle);
    stream.onopen = () => {
      if (active) setLive(true);
    };
    stream.onerror = () => {
      if (active) setLive(false);
    };
    return () => {
      active = false;
      stream.close();
      setLive(false);
    };
  }, [id, joined, user?.id]);
  const join = async () => {
    if (!requireUser()) return;
    const requestedIdentity = identityRef.current;
    setBusy(true);
    setError('');
    try {
      const data = await send(`/api/rooms/${id}/join`, { invite });
      if (identityRef.current === requestedIdentity) resource.setData(data);
    } catch (e) {
      if (identityRef.current === requestedIdentity) setError(e.message);
    } finally {
      if (identityRef.current === requestedIdentity) setBusy(false);
    }
  };
  const update = async (patch) => {
    const requestedIdentity = identityRef.current;
    try {
      const data = await send(`/api/rooms/${id}`, { ...patch, version: room.version }, 'PATCH');
      if (identityRef.current === requestedIdentity)
        resource.setData((old) =>
          old?.room?.version > data.room.version ? old : { room: { ...old?.room, ...data.room } },
        );
    } catch (e) {
      if (identityRef.current === requestedIdentity) setError(e.message);
    }
  };
  const leave = async () => {
    const requestedIdentity = identityRef.current;
    try {
      await send(`/api/rooms/${id}/leave`, {});
      if (identityRef.current !== requestedIdentity) return;
      navigate('/rooms');
      notify('You left the room.');
    } catch (e) {
      if (identityRef.current === requestedIdentity) setError(e.message);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify('Invitation copied');
    } catch {
      notify('Copy the invitation from your address bar.', 'error');
    }
  };
  if (resource.loading) return <Loading />;
  if (resource.error || !room)
    return (
      <div className="page">
        <Link className="back-link" to="/rooms">
          <ArrowLeft size={15} />
          All rooms
        </Link>
        <Empty icon={Lock} title="This seat needs an invitation.">
          {resource.error || 'The room may have closed.'}
        </Empty>
      </div>
    );
  return (
    <div className="page active-room">
      <Link className="back-link" to="/rooms">
        <ArrowLeft size={15} />
        All rooms
      </Link>
      <div className="page-heading with-actions">
        <div>
          <span className="eyebrow">
            <span className="live-dot" />
            {room.type === 'watch' ? 'WATCH PARTY' : 'READING CIRCLE'} ·{' '}
            {room.visibility.toUpperCase()}
          </span>
          <h1>{room.name}</h1>
          <p>
            {titleOf(room.media)} · {room.type === 'watch' ? 'Episode' : 'Chapter'}{' '}
            <span data-testid="room-unit">{room.unit}</span>
          </p>
        </div>
        <div className="heading-buttons">
          <Button variant="secondary" onClick={copy}>
            <Copy size={16} />
            Invite friends
          </Button>
          {joined ? (
            <Button variant="subtle" onClick={leave}>
              <DoorOpen size={17} />
              Leave room
            </Button>
          ) : (
            <Button onClick={join} busy={busy}>
              <Users size={17} />
              Join room
            </Button>
          )}
        </div>
      </div>
      {error && <ErrorNotice message={error} />}
      <div className="room-layout">
        <div className="room-stage">
          {joined ? (
            room.sourceUrl ? (
              ['video', 'hls'].includes(room.sourceKind) ? (
                <SyncedVideo
                  room={room}
                  isHost={host}
                  onState={update}
                  poster={bannerOf(room.media)}
                />
              ) : (
                <ExternalPlayer
                  source={{ url: room.sourceUrl, kind: room.sourceKind }}
                  poster={bannerOf(room.media)}
                  title={titleOf(room.media)}
                />
              )
            ) : (
              <div
                className="room-empty-stage"
                style={{ '--player-poster': `url("${bannerOf(room.media)}")` }}
              >
                <span className="empty-icon">
                  {room.type === 'watch' ? <Play size={31} /> : <BookOpen size={31} />}
                </span>
                <h2>{host ? 'Set the scene.' : 'Waiting for the host.'}</h2>
                <p>
                  {host
                    ? 'Add a video or reading source, and let the good night begin.'
                    : 'The host will choose a source. Get comfortable and say hello in the chat.'}
                </p>
                {host && (
                  <Button onClick={() => setSourceOpen(true)}>
                    <Link2 size={17} />
                    Add a source
                  </Button>
                )}
              </div>
            )
          ) : (
            <div className="room-empty-stage">
              <Users size={38} />
              <h2>There’s a seat for you.</h2>
              <p>Join to see the shared source and take part in the live chat.</p>
              <Button onClick={join} busy={busy}>
                Join room
                <ArrowRight size={17} />
              </Button>
            </div>
          )}
          <div className="room-sync-bar">
            <span className={`live-dot ${!live ? 'muted-dot' : ''}`} />
            <strong>
              {joined ? (live ? 'Connected to the room' : 'Connecting…') : 'Previewing room'}
            </strong>
            <span>
              {room.sourceUrl && ['video', 'hls'].includes(room.sourceKind)
                ? 'Playback follows the host'
                : room.type === 'read'
                  ? 'Shared chapter · read at your own pace'
                  : 'Shared episode · provider playback is independent'}
            </span>
          </div>
          {joined && host && (
            <div className="host-controls">
              <div>
                <Crown size={18} />
                <strong>You’re the host</strong>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  update({ unit: Number(unitDraft), position: 0, paused: true });
                }}
              >
                <label>
                  {room.type === 'watch' ? 'Episode' : 'Chapter'}
                  <input
                    aria-label="Room unit"
                    type="number"
                    min="1"
                    max="100000"
                    value={unitDraft}
                    onChange={(e) => setUnitDraft(e.target.value)}
                  />
                </label>
                <Button type="submit" variant="subtle">
                  Go
                  <ArrowRight size={15} />
                </Button>
              </form>
              <Button variant="subtle" onClick={() => setSourceOpen(true)}>
                <Link2 size={15} />
                {room.sourceUrl ? 'Change source' : 'Add source'}
              </Button>
              {['video', 'hls'].includes(room.sourceKind) && (
                <>
                  <Button
                    variant="secondary"
                    aria-label={room.paused ? 'Play for everyone' : 'Pause for everyone'}
                    onClick={() => update({ paused: !room.paused })}
                  >
                    {room.paused ? <Play size={16} /> : <Pause size={16} />}
                  </Button>
                  <span data-testid="room-playback-state">
                    {room.paused ? 'Paused' : 'Playing'}
                  </span>
                </>
              )}
            </div>
          )}
          <div className="room-members">
            <h3>
              <Users size={18} />
              In good company{' '}
              <small>
                {room.memberCount}/{room.capacity}
              </small>
            </h3>
            <div>
              {room.members?.map((member) => (
                <span key={member.id}>
                  <Avatar user={member} size="small" />
                  <strong>{member.name}</strong>
                  {member.id === room.hostId && <Crown size={13} />}
                </span>
              ))}
            </div>
          </div>
          <Link
            to={`/${room.type === 'watch' ? 'watch' : 'read'}/${room.mediaId}/${room.unit}`}
            className="text-link"
          >
            Open {room.type === 'watch' ? 'episode' : 'chapter'} discussion
            <ArrowRight size={16} />
          </Link>
        </div>
        <Chat roomId={id} roomEvent={roomEvent} enabled={joined} live={live} />
      </div>
      {sourceOpen && (
        <SourceForm
          close={() => setSourceOpen(false)}
          initial={{ url: room.sourceUrl, kind: room.sourceKind }}
          onSave={async (source) => {
            const requestedIdentity = identityRef.current;
            const data = await send(
              `/api/rooms/${id}`,
              { sourceUrl: source.url, sourceKind: source.kind, position: 0, paused: true },
              'PATCH',
            );
            if (identityRef.current === requestedIdentity)
              resource.setData((old) => ({ room: { ...old?.room, ...data.room } }));
          }}
        />
      )}
    </div>
  );
}
