import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Heart, Search } from 'lucide-react';
import { send } from './api';
import { Button, ErrorNotice, Modal } from './components';
import { useApp } from './state';

export default function FavoritesImport({ close }) {
  const { refreshLibrary, notify } = useApp();
  const [username, setUsername] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const lookup = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const result = await send('/api/import/favorites/preview', { username: username.trim() });
      if (active.current) setPreview(result);
    } catch (err) {
      if (active.current) setError(err.message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const commit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await send('/api/import/favorites/commit', {
        previewToken: preview.previewToken,
      });
      if (!active.current) return;
      await refreshLibrary();
      if (!active.current) return;
      notify(result.message || `${result.imported} favorites added to your library`);
      close();
    } catch (err) {
      if (active.current) setError(err.message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <Modal title="Import public MAL favorites" close={close} wide>
      <span className="eyebrow">THE ONES THAT STAY WITH YOU</span>
      <h2>Bring your favorites home.</h2>
      <p className="muted">
        Find the anime and manga favorites on your public MyAnimeList profile. Review them before
        adding them to Yoru.
      </p>
      <form className="form-stack" onSubmit={lookup}>
        <label>
          MyAnimeList username
          <input
            name="username"
            autoComplete="off"
            placeholder="Your MAL username"
            value={username}
            maxLength={32}
            pattern="[A-Za-z0-9_-]+"
            required
            disabled={busy}
            onChange={(e) => {
              setUsername(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        <p className="small muted">
          Your username is sent to Jikan to read your public MAL favorites. No MAL password or
          account connection is needed.
        </p>
        <Button variant="secondary" type="submit" busy={busy}>
          <Search size={16} />
          Preview favorites
        </Button>
      </form>
      {error && <ErrorNotice message={error} />}
      {preview && (
        <div className="import-preview">
          <div className="import-total">
            <Heart size={20} />
            <strong>
              {preview.total
                ? `${preview.total} favorites from ${preview.username}`
                : 'No public favorites found'}
            </strong>
          </div>
          <p>
            {preview.anime} anime · {preview.manga} manga & manhwa
          </p>
          {preview.total > 0 ? (
            <>
              <div className="import-titles">
                {preview.items.map((item) => (
                  <div key={item.mediaId}>
                    <span>{item.title}</span>
                    <small>{item.type === 'ANIME' ? 'Anime' : 'Manga / manhwa'}</small>
                  </div>
                ))}
              </div>
              <p className="small muted">
                These stories will be marked as favorites. Your current progress, ratings, and other
                favorites stay as they are. New stories go on your “For later” shelf.
              </p>
              <Button busy={busy} onClick={commit}>
                Import {preview.total} favorites
                <ArrowRight size={16} />
              </Button>
            </>
          ) : (
            <p className="small muted">
              Check the username and whether your MAL favorites are public. You can still mark any
              story as a favorite in Yoru.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
