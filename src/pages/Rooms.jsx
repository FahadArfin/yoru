import { roomInvite } from '../room-invites';
import { CreateRoom } from '../RoomLauncher';
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from '../collection-router';
import { ArrowRight, BookOpen, Play, Plus, Radio, Users } from 'lucide-react';
import { bannerOf, itemsOf, titleOf } from '../api';
import { useApp, useResource } from '../state';
import { Avatar, Badge, Button, Empty, ErrorNotice, Loading } from '../components';
export default function Rooms() {
  const resource = useResource('/api/rooms', false);
  const { requireUser, event, user } = useApp();
  const [params] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState('all');
  useEffect(() => {
    if (['rooms', 'snapshot'].includes(event?.type)) resource.refresh();
  }, [event]);
  const list = itemsOf(resource.data).filter((room) => type === 'all' || room.type === type);
  return (
    <div className="page rooms-page">
      <div className="page-heading with-actions">
        <div>
          <span className="eyebrow">ANOTHER EPISODE. A LITTLE COMPANY.</span>
          <h1>Public rooms &amp; your invitations.</h1>
          <p>Find a watch party, start a reading circle, or save a seat for your friends.</p>
        </div>
        <Button
          onClick={() => {
            if (requireUser()) setCreating(true);
          }}
        >
          <Plus size={17} />
          Create a room
        </Button>
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">THERE’S A SEAT WITH YOUR NAME ON IT</span>
          <h2>Find your room</h2>
        </div>
        <div className="segmented">
          {[
            ['all', 'All rooms'],
            ['watch', 'Watch'],
            ['read', 'Read'],
          ].map(([key, label]) => (
            <button key={key} className={type === key ? 'active' : ''} onClick={() => setType(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {resource.loading ? (
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
                <img src={bannerOf(room.media)} alt="" loading="lazy" />
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
      {creating && (
        <CreateRoom close={() => setCreating(false)} initialMedia={params.get('media')} />
      )}
    </div>
  );
}
