import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, Lock, Play, Plus, Radio, Users } from 'lucide-react';
import { bannerOf, isAnime, itemsOf, send, titleOf } from '../api';
import { useApp, useResource } from '../state';
import { Avatar, Badge, Button, Empty, ErrorNotice, Loading, Modal } from '../components';
export default function Rooms() {
  const resource = useResource('/api/rooms', false);
  const { requireUser, event } = useApp();
  const [params] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState('all');
  useEffect(() => {
    if (event?.type === 'rooms') resource.refresh();
  }, [event]);
  const list = itemsOf(resource.data).filter((room) => type === 'all' || room.type === type);
  return (
    <div className="page rooms-page">
      <div className="page-heading with-actions">
        <div>
          <span className="eyebrow">ANOTHER EPISODE. A LITTLE COMPANY.</span>
          <h1>Everything’s better together.</h1>
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
      <div className="rooms-intro">
        <div className="rooms-orbits">
          <Users size={42} />
          <span />
          <span />
        </div>
        <div>
          <Badge tone="violet">YOUR NIGHT, YOUR WAY</Badge>
          <h2>
            Same moment.
            <br />
            Different couches.
          </h2>
          <p>
            Watch in sync with supported video sources, follow the same chapter, and keep the
            conversation going.
          </p>
        </div>
        <div className="room-feature-list">
          <span>
            <Play size={17} />
            Watch parties
          </span>
          <span>
            <BookOpen size={17} />
            Reading circles
          </span>
          <span>
            <Lock size={17} />
            Private invitations
          </span>
        </div>
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
            <Link to={`/rooms/${room.id}`} className="room-card" key={room.id}>
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
function CreateRoom({ close, initialMedia }) {
  const navigate = useNavigate();
  const [category, setCategory] = useState(initialMedia?.includes('manga') ? 'MANGA' : 'ANIME');
  const catalog = useResource(`/api/catalog?category=${category}`);
  const [selected, setSelected] = useState(initialMedia || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError('');
    try {
      const data = await send('/api/rooms', {
        ...values,
        mediaId: selected || itemsOf(catalog.data)[0]?.id,
        type: category === 'ANIME' ? 'watch' : 'read',
        capacity: Number(values.capacity),
        unit: Number(values.unit),
      });
      navigate(data.inviteUrl || `/rooms/${data.room.id}`);
      close();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Create a room" close={close}>
      <span className="eyebrow">SAVE A SEAT</span>
      <h2>Make a night of it.</h2>
      <p className="muted">You bring the story. We’ll keep everyone together.</p>
      <form className="form-stack" onSubmit={submit}>
        <label>
          Room name
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            placeholder="One more episode club"
          />
        </label>
        <label>
          Story type
          <select
            aria-label="Room story type"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSelected('');
            }}
          >
            <option value="ANIME">Anime watch party</option>
            <option value="MANGA">Manga reading circle</option>
            <option value="MANHWA">Manhwa reading circle</option>
          </select>
        </label>
        <label>
          Choose a story
          <select
            aria-label="Room story"
            value={selected || itemsOf(catalog.data)[0]?.id || ''}
            onChange={(e) => setSelected(e.target.value)}
            required
          >
            {initialMedia && !itemsOf(catalog.data).some((x) => x.id === initialMedia) && (
              <option value={initialMedia}>Selected title</option>
            )}
            {itemsOf(catalog.data).map((media) => (
              <option key={media.id} value={media.id}>
                {titleOf(media)}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            {category === 'ANIME' ? 'Episode' : 'Chapter'}
            <input
              name="unit"
              aria-label="Starting unit"
              type="number"
              min="1"
              max="100000"
              defaultValue="1"
              required
            />
          </label>
          <label>
            Seats
            <select aria-label="Seats" name="capacity" defaultValue="8">
              <option value="2">2 people</option>
              <option value="4">4 people</option>
              <option value="8">8 people</option>
              <option value="12">12 people</option>
              <option value="20">20 people</option>
            </select>
          </label>
        </div>
        <label>
          Who can join?
          <select aria-label="Who can join?" name="visibility" defaultValue="public">
            <option value="public">Public · open to everyone</option>
            <option value="private">Private · invitation link only</option>
          </select>
        </label>
        {error && <ErrorNotice message={error} />}
        <Button type="submit" busy={busy} disabled={catalog.loading && !initialMedia}>
          Create room
          <ArrowRight size={17} />
        </Button>
      </form>
    </Modal>
  );
}
