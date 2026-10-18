import { readerAtUnit } from '../shared/room-reader';
import { rememberRoomInvite } from './room-invites';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from './collection-router';
import { ArrowRight, Users } from 'lucide-react';
import { coverOf, isAnime, itemsOf, send, titleOf } from './api';
import { useApp, useResource } from './state';
import { Button, ErrorNotice, Modal } from './components';
import { sourceForUnit } from './room-source';

export default function RoomLauncher({ media, unit = 1, source, getPosition }) {
  const { requireUser, user } = useApp();
  const [context, setContext] = useState(null);
  useEffect(() => setContext(null), [media?.id, unit, user?.id]);
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          if (requireUser()) setContext({ source, position: getPosition?.() || 0 });
        }}
      >
        <Users size={17} />
        {isAnime(media) ? 'Watch together' : 'Read together'}
      </Button>
      {context && (
        <CreateRoom close={() => setContext(null)} media={media} unit={unit} {...context} />
      )}
    </>
  );
}

export function CreateRoom({ close, initialMedia, media, unit = 1, source, position = 0 }) {
  const navigate = useNavigate();
  const [category, setCategory] = useState(
    media?.category || (initialMedia?.includes('manga') ? 'MANGA' : 'ANIME'),
  );
  const catalog = useResource(media ? null : `/api/catalog?category=${category}`);
  const { user } = useApp();
  const identity = useRef(user?.id);
  identity.current = user?.id;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [selected, setSelected] = useState(media?.id || initialMedia || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    if (busy) return;
    const account = identity.current;
    setBusy(true);
    setError('');
    try {
      const pickedId = selected || itemsOf(catalog.data)[0]?.id;
      const chosen =
        media && category === 'ANIME'
          ? sourceForUnit(pickedId, Number(values.unit), source, unit)
          : media
            ? {
                kind: 'reader',
                url:
                  Number(values.unit) === unit && source?.kind === 'reader'
                    ? source.url
                    : readerAtUnit(
                        source?.url || `/read/${pickedId}/${values.unit}`,
                        pickedId,
                        Number(values.unit),
                      ),
              }
            : null;
      const data = await send('/api/rooms', {
        ...values,
        mediaId: pickedId,
        sourceUrl: chosen?.url || '',
        sourceKind: chosen?.kind || 'external',
        position:
          chosen && ['video', 'hls'].includes(chosen.kind) && Number(values.unit) === unit
            ? position
            : 0,
        type: category === 'ANIME' ? 'watch' : 'read',
        capacity: Number(values.capacity),
        unit: Number(values.unit),
      });
      if (!mounted.current || identity.current !== account) return;
      rememberRoomInvite(account, data.room.id, data.inviteUrl);
      if (media) {
        navigate(data.inviteUrl, { state: { shareRoom: true } });
        close();
        return;
      }
      navigate(data.inviteUrl || `/rooms/${data.room.id}`);
      close();
    } catch (e) {
      if (mounted.current && identity.current === account) setError(e.message);
    } finally {
      if (mounted.current && identity.current === account) setBusy(false);
    }
  };
  return (
    <Modal title="Create a room" close={busy ? () => {} : close}>
      <span className="eyebrow">SAVE A SEAT</span>
      <h2>Make a night of it.</h2>
      <p className="muted">You bring the story. We’ll keep everyone together.</p>
      {media && (
        <div className="room-context">
          <img src={coverOf(media)} alt="" />
          <div>
            <strong>{titleOf(media)}</strong>
            <small>{isAnime(media) ? 'Watch party' : 'Reading circle'}</small>
          </div>
        </div>
      )}
      <form className="form-stack" onSubmit={submit}>
        <label>
          Room name
          <input
            name="name"
            defaultValue={media ? `${titleOf(media).slice(0, 60)} together` : undefined}
            required
            minLength={2}
            maxLength={80}
            placeholder="One more episode club"
          />
        </label>
        {!media && (
          <>
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
          </>
        )}
        <div className="form-row">
          <label>
            {category === 'ANIME' ? 'Episode' : 'Chapter'}
            <input
              name="unit"
              aria-label="Starting unit"
              type="number"
              min={category === 'ANIME' ? 1 : 0}
              step={category === 'ANIME' ? 1 : 'any'}
              max="100000"
              defaultValue={unit}
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
          <select
            aria-label="Who can join?"
            name="visibility"
            defaultValue={media ? 'private' : 'public'}
          >
            <option value="public">Public · open to everyone</option>
            <option value="private">Private · invitation link only</option>
          </select>
        </label>
        {media && (
          <p className="room-sync-note">
            {category !== 'ANIME'
              ? 'Everyone follows the same chapter and chats live. Personal reading files stay on your device.'
              : source && ['video', 'hls'].includes(source.kind)
                ? 'Play, pause, and seeking follow the host. Everyone joins at the shared timestamp.'
                : 'This provider shares the episode, but does not expose synchronized playback. Add a direct video or HLS source in the room to follow the host automatically.'}
          </p>
        )}
        {error && <ErrorNotice message={error} />}
        <Button type="submit" busy={busy} disabled={!media && catalog.loading && !initialMedia}>
          Create room
          <ArrowRight size={17} />
        </Button>
      </form>
    </Modal>
  );
}
