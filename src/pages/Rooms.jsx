import { roomInvite } from '../room-invites';
import { CreateRoom } from '../RoomLauncher';
import CoverImage from '../CoverImage';
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from '../collection-router';
import { ArrowRight, BookOpen, Play, Plus, Radio, Users } from 'lucide-react';
import { itemsOf, titleOf } from '../api';
import { useApp } from '../state';
import { useReaderResource } from '../reader/use-resource';
import { readerContextKey } from '../reader/requests';
import { Avatar, Badge, Button, Empty, ErrorNotice, Loading } from '../components';
import { SpaceControls } from '../SpaceLayout';
export default function Rooms() {
  const [page, setPage] = useState(null);
  const [accumulated, setAccumulated] = useState({ key: '', items: [] });
  const base = useReaderResource('/api/rooms', { force: true });
  const contextKey = readerContextKey(base.context);
  const pageQuery = page?.key === contextKey ? page.query : '';
  const continuation = useReaderResource(pageQuery ? `/api/rooms?${pageQuery}` : null, {
    force: true,
  });
  const resource = pageQuery ? continuation : base;
  const { requireUser, event, user } = useApp();
  const [params] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState('all');
  useEffect(() => {
    if (['rooms', 'snapshot'].includes(event?.type)) {
      setPage(null);
      base.refresh();
    }
  }, [event]);
  useEffect(() => {
    if (!resource.data) return;
    setAccumulated((old) => ({
      key: contextKey,
      items: [
        ...new Map(
          [
            ...(pageQuery && old.key === contextKey ? old.items : []),
            ...itemsOf(resource.data),
          ].map((room) => [room.id, room]),
        ).values(),
      ],
    }));
  }, [contextKey, pageQuery, resource.data]);
  const list = (accumulated.key === contextKey ? accumulated.items : []).filter(
    (room) => type === 'all' || room.type === type,
  );
  return (
    <div className="page rooms-page">
      <h1 className="sr-only">Rooms</h1>
      <div className="space-page-actions">
        <Button
          onClick={() => {
            if (requireUser()) setCreating(true);
          }}
        >
          <Plus size={17} />
          Create a room
        </Button>
      </div>
      <SpaceControls label="Room type">
        {[
          ['all', 'All rooms'],
          ['watch', 'Watch'],
          ['read', 'Read'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={type === key ? 'active' : ''}
            aria-pressed={type === key}
            onClick={() => setType(key)}
          >
            {label}
          </button>
        ))}
      </SpaceControls>
      {resource.loading && !list.length ? (
        <Loading />
      ) : resource.error ? (
        <ErrorNotice message={resource.error} retry={resource.refresh} />
      ) : list.length ? (
        <div className="room-grid">
          {list.map((room) => (
            <Link
              to={roomInvite(user?.id, room) || `/rooms/${room.id}`}
              className="room-card"
              key={room.id}
            >
              <div className="room-card-art">
                <CoverImage media={room.media} alt="" loading="lazy" />
                <Badge tone="green">
                  <Radio size={12} />
                  {room.memberCount} / {room.capacity}
                </Badge>
                <span className="room-type">
                  {room.type === 'watch' ? <Play size={14} /> : <BookOpen size={14} />}{' '}
                  {room.type === 'watch' ? 'Watch party' : 'Reading circle'}
                </span>
              </div>
              <div className="room-card-body">
                <span className="eyebrow">{titleOf(room.media)}</span>
                <h3>{room.name}</h3>
                <p>
                  {room.type === 'watch' ? 'Episode' : 'Chapter'} {room.unit} ·{' '}
                  {room.visibility === 'private' ? 'Invite only' : 'Everyone’s welcome'}
                </p>
                <div className="room-card-footer">
                  <Avatar user={room.host} size="small" />
                  <span>
                    Hosted by <strong>{room.host?.name}</strong>
                  </span>
                  <ArrowRight size={18} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : resource.data?.complete === false ? (
        <p role="status">
          No eligible rooms in this part of the list. Continue checking for more rooms.
        </p>
      ) : (
        <Empty
          icon={Users}
          title="Someone has to start the good night."
          action={
            <Button
              onClick={() => {
                if (requireUser()) setCreating(true);
              }}
            >
              Create the first room
              <Plus size={16} />
            </Button>
          }
        >
          Pick a story, invite your people, and make this corner of the internet yours.
        </Empty>
      )}
      {resource.data?.complete === false && (
        <div>
          <p role="status">More rooms are available to check.</p>
          {(resource.data.nextCursor != null || resource.data.nextSourceCursor != null) && (
            <Button
              disabled={resource.loading}
              onClick={() =>
                setPage({
                  key: contextKey,
                  query: new URLSearchParams({
                    ...(resource.data.nextCursor != null
                      ? { cursor: resource.data.nextCursor }
                      : {}),
                    ...(resource.data.nextSourceCursor != null
                      ? { sourceCursor: resource.data.nextSourceCursor }
                      : {}),
                  }).toString(),
                })
              }
            >
              Check more rooms
            </Button>
          )}
        </div>
      )}
      {creating && (
        <CreateRoom close={() => setCreating(false)} initialMedia={params.get('media')} />
      )}
    </div>
  );
}
