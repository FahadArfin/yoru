import React, { useState } from 'react';
import { Link } from '../collection-router';
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Check,
  Download,
  FileUp,
  Heart,
  Search,
  Trash2,
} from 'lucide-react';
import { api, coverOf, isAnime, kindOf, send, titleOf } from '../api';
import { useApp } from '../state';
import { Button, Empty, ErrorNotice, Modal } from '../components';
import FavoritesImport from '../FavoritesImport';
export default function Library() {
  const { user, library, setAuthOpen, requireUser, updateEntry, refreshLibrary, notify } = useApp();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const list = library.filter(
    (item) =>
      (tab === 'all' ||
        (tab === 'favorites'
          ? item.favorite
          : tab === 'active'
            ? ['watching', 'reading'].includes(item.status)
            : tab === item.status)) &&
      (titleOf(item.media).toLowerCase().includes(search.toLowerCase()) || !search),
  );
  const remove = async (item) => {
    try {
      await send(`/api/library/${item.mediaId}`, {}, 'DELETE');
      await refreshLibrary();
      notify('Removed from your library');
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const exportList = async () => {
    try {
      const exported = await api('/api/library/export');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'yoru-library.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notify(error.message, 'error');
    }
  };
  return (
    <div className="page">
      <div className="page-heading with-actions">
        <div>
          <span className="eyebrow">A COLLECTION THAT’S VERY YOU</span>
          <h1>Your little universe.</h1>
          <p>Every obsession. Every saved seat. Right where you left it.</p>
        </div>
        <div className="heading-buttons">
          {user && (
            <button className="icon-button" aria-label="Export library" onClick={exportList}>
              <Download size={20} />
            </button>
          )}
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <FileUp size={17} />
            Import from MAL
          </Button>
          <Button
            variant="subtle"
            onClick={() => {
              if (requireUser()) setFavoritesOpen(true);
            }}
          >
            <Heart size={17} />
            Import MAL favorites
          </Button>
        </div>
      </div>
      {!user ? (
        <Empty
          icon={Bookmark}
          title="Your favorites deserve a home."
          action={
            <Button onClick={() => setAuthOpen(true)}>
              Sign in to start your library
              <ArrowRight size={16} />
            </Button>
          }
        >
          Keep your anime, manga, and manhwa together. Your progress goes wherever you do.
        </Empty>
      ) : (
        <>
          <div className="library-stats">
            <div>
              <Bookmark size={19} />
              <strong>{library.length}</strong>
              <span>stories saved</span>
            </div>
            <div>
              <BookOpen size={19} />
              <strong>
                {library.filter((item) => ['watching', 'reading'].includes(item.status)).length}
              </strong>
              <span>in progress</span>
            </div>
            <div>
              <Check size={19} />
              <strong>{library.filter((item) => item.status === 'completed').length}</strong>
              <span>finished stories</span>
            </div>
            <div>
              <Heart size={19} />
              <strong>{library.filter((item) => item.favorite).length}</strong>
              <span>all-time favorites</span>
            </div>
          </div>
          <div className="library-controls">
            <div className="detail-tabs">
              {[
                ['all', 'All stories'],
                ['active', 'In progress'],
                ['planned', 'For later'],
                ['completed', 'Completed'],
                ['favorites', 'Favorites'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={tab === key ? 'active' : ''}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="inline-search">
              <Search size={17} />
              <input
                aria-label="Search your library"
                placeholder="Find in your library…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          {list.length ? (
            <div className="library-list">
              {list.map((item) => (
                <article key={item.mediaId} className="library-row">
                  <Link to={`/title/${item.mediaId}`}>
                    <img src={coverOf(item.media)} alt="" />
                  </Link>
                  <div className="library-title">
                    <span className="eyebrow">{kindOf(item.media)}</span>
                    <Link to={`/title/${item.mediaId}`}>
                      {item.media ? titleOf(item.media) : item.mediaId}
                    </Link>
                    <span>
                      {isAnime(item.media) ? 'Episode' : 'Chapter'} {item.progress || 0}{' '}
                      {item.media?.total ? `of ${item.media.total}` : ''}
                    </span>
                    <div className="progress-track">
                      <span
                        style={{
                          width: `${item.media?.total ? Math.min(100, (item.progress / item.media.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  <select
                    aria-label={`Status for ${titleOf(item.media)}`}
                    value={item.status}
                    onChange={(e) =>
                      updateEntry(item.media || { id: item.mediaId }, { status: e.target.value })
                    }
                  >
                    <option value="planned">For later</option>
                    <option value={isAnime(item.media) ? 'watching' : 'reading'}>
                      In progress
                    </option>
                    <option value="completed">Completed</option>
                    <option value="paused">On hold</option>
                    <option value="dropped">Dropped</option>
                  </select>
                  <Link
                    className="btn btn-subtle"
                    to={`/${isAnime(item.media) ? 'watch' : 'read'}/${item.mediaId}/${Math.max(1, item.progress)}`}
                  >
                    Continue
                    <ArrowRight size={15} />
                  </Link>
                  <button
                    aria-label={`Remove ${titleOf(item.media)} from library`}
                    className="icon-button"
                    onClick={() => remove(item)}
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              icon={Bookmark}
              title={
                library.length ? 'Nothing on this shelf yet.' : 'The beginning of a very good list.'
              }
              action={
                <Link to="/browse/all" className="btn btn-primary">
                  Find your first favorite
                  <ArrowRight size={16} />
                </Link>
              }
            >
              Save a title from Discover, or bring your collection over from MyAnimeList.
            </Empty>
          )}
        </>
      )}
      {importOpen && <ImportModal close={() => setImportOpen(false)} />}
      {favoritesOpen && user && (
        <FavoritesImport key={user.id} close={() => setFavoritesOpen(false)} />
      )}
    </div>
  );
}
function ImportModal({ close }) {
  const { requireUser, refreshLibrary, notify } = useApp();
  const [xml, setXml] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const select = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setPreview(null);
    if (file.size > 2 * 1024 * 1024) {
      setError('Please choose an XML export smaller than 2 MB.');
      return;
    }
    setBusy(true);
    try {
      const value = await file.text();
      const data = await send('/api/import/preview', { xml: value });
      setXml(value);
      setPreview(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!requireUser()) return;
    setBusy(true);
    setError('');
    try {
      const result = await send('/api/import/commit', { xml });
      await refreshLibrary();
      notify(result.message);
      close();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Import from MyAnimeList" close={close} wide>
      <span className="eyebrow">BRING YOUR UNIVERSE WITH YOU</span>
      <h2>
        A fresh home.
        <br />
        Same favorite stories.
      </h2>
      <p className="muted">
        Import your MyAnimeList anime or manga XML export, including your list status and episode or
        chapter progress.
      </p>
      <ol className="import-steps">
        <li>
          Open{' '}
          <a href="https://myanimelist.net/panel.php?go=export" target="_blank" rel="noreferrer">
            MyAnimeList’s export page
          </a>{' '}
          and export your list.
        </li>
        <li>Unzip the downloaded file, then choose the .xml file below.</li>
        <li>Review the import and save it to your Yoru account.</li>
      </ol>
      <label className="file-upload">
        <FileUp size={30} />
        <strong>{busy ? 'Reading your list…' : 'Choose your MAL export'}</strong>
        <span>XML · up to 2 MB</span>
        <input
          aria-label="MyAnimeList XML file"
          type="file"
          accept=".xml,text/xml,application/xml"
          onChange={select}
        />
      </label>
      {error && <ErrorNotice message={error} />}{' '}
      {preview && (
        <div className="import-preview">
          <div className="import-total">
            <Check size={20} />
            <strong>{preview.total} stories ready to come home</strong>
          </div>
          <p>
            {preview.anime} anime · {preview.manga} manga & manhwa
          </p>
          <div className="import-titles">
            {preview.items.slice(0, 6).map((item) => (
              <div key={item.mediaId}>
                <span>{item.title}</span>
                <small>
                  {item.status} · {item.progress}
                </small>
              </div>
            ))}
          </div>
          {preview.warnings?.map((w) => (
            <p className="small muted" key={w}>
              {w}
            </p>
          ))}
          <Button busy={busy} onClick={commit}>
            Import {preview.total} titles
            <ArrowRight size={16} />
          </Button>
        </div>
      )}
    </Modal>
  );
}
