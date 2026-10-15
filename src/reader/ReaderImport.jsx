import React, { useEffect, useRef, useState } from 'react';
import { FileJson, Images, Upload } from 'lucide-react';
import { Button, ErrorNotice, Modal } from '../components';
import { titleOf } from '../api';
import { MAX_MANIFEST_BYTES, parseManifest } from './model';
import { imageChapter, saveChapters } from './storage';

export default function ReaderImport({ media, close, onImport, initialNumber = '1' }) {
  const [tab, setTab] = useState('manifest');
  const [chapters, setChapters] = useState([]);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState('');
  const selection = useRef(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const dismiss = () => {
    active.current = false;
    selection.current++;
    close();
  };
  const readManifest = async (event) => {
    const selected = ++selection.current;
    setChapters([]);
    setError('');
    const file = event.target.files[0];
    if (!file) return;
    setFilename(file.name);
    try {
      if (file.size > MAX_MANIFEST_BYTES)
        throw new Error('Choose a chapter manifest smaller than 2 MB.');
      const parsed = parseManifest(await file.text());
      if (selected === selection.current) setChapters(parsed);
    } catch (error) {
      if (selected === selection.current) setError(error.message);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const incoming = tab === 'manifest' ? chapters : [await imageChapter(files, data)];
      if (!active.current) return;
      if (!incoming.length) throw new Error('Choose a chapter manifest first.');
      const all = await saveChapters(media.id, incoming);
      if (!active.current) return;
      onImport(all, incoming[0]);
      dismiss();
    } catch (error) {
      if (active.current) setError(error.message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <Modal title="Add chapters" close={dismiss} wide>
      <span className="eyebrow">YOUR PERSONAL READER</span>
      <h2>Add chapters for {titleOf(media)}</h2>
      <p className="muted">
        Open your own page images or a Cubari-style chapter manifest. Imports stay on this device.
      </p>
      <div className="reader-import-tabs" role="tablist" aria-label="Import format">
        {[
          ['manifest', 'Chapter manifest', FileJson],
          ['images', 'Image files', Images],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setError('');
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="form-stack">
        {tab === 'manifest' ? (
          <>
            <label className="reader-file-drop">
              <FileJson size={28} />
              <strong>Choose a JSON chapter manifest</strong>
              <span>Up to 2 MB · Cubari groups or a chapters array</span>
              <input
                aria-label="Chapter manifest"
                type="file"
                accept=".json,application/json"
                onChange={readManifest}
              />
            </label>
            {chapters.length > 0 && (
              <div className="reader-import-preview">
                <strong>{filename}</strong>
                <span>
                  {chapters.length} chapter editions ·{' '}
                  {chapters.reduce((n, c) => n + c.pages.length, 0)} pages
                </span>
                <small>
                  These chapters will be attached to {titleOf(media)}. Matching editions replace the
                  previous page list.
                </small>
              </div>
            )}
            <details className="reader-format-help">
              <summary>What does a chapter manifest look like?</summary>
              <pre>
                {JSON.stringify(
                  {
                    title: 'My story',
                    chapters: {
                      1: {
                        title: 'Chapter one',
                        volume: '1',
                        language: 'en',
                        groups: {
                          'My edition': [
                            'https://example.com/page-1.jpg',
                            'https://example.com/page-2.jpg',
                          ],
                        },
                      },
                    },
                  },
                  null,
                  2,
                )}
              </pre>
              <p>
                Page links need to permit image loading. Reader websites and MangaDex title URLs are
                not page manifests.
              </p>
            </details>
          </>
        ) : (
          <>
            <label className="reader-file-drop">
              <Images size={28} />
              <strong>Choose the pages in this chapter</strong>
              <span>JPG, PNG, WebP, GIF or AVIF · up to 100 MB</span>
              <input
                aria-label="Chapter images"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                multiple
                onChange={(event) => setFiles([...event.target.files])}
              />
            </label>
            {files.length > 0 && (
              <p className="reader-import-preview">
                {files.length} pages · ordered by filename, with page 2 before page 10.
              </p>
            )}
            <div className="reader-form-grid">
              <label>
                Chapter number
                <input
                  name="number"
                  aria-label="Import chapter number"
                  defaultValue={initialNumber}
                  required
                  pattern="[0-9]{1,6}(\.[0-9]{1,3})?"
                />
              </label>
              <label>
                Language
                <select name="language" defaultValue="en">
                  <option value="en">English</option>
                  <option value="ja">Japanese</option>
                  <option value="ko">Korean</option>
                  <option value="zh">Chinese</option>
                  <option value="es">Spanish</option>
                  <option value="und">Unspecified</option>
                </select>
              </label>
            </div>
            <label>
              Chapter title
              <input name="title" maxLength="160" placeholder="Optional" />
            </label>
            <label>
              Edition name
              <input name="group" maxLength="160" defaultValue="Local files" required />
            </label>
          </>
        )}
        <p className="small muted">
          Use pages you have permission to read. Yoru does not upload your files or import a
          provider’s catalog.
        </p>
        {error && <ErrorNotice message={error} />}
        <Button
          type="submit"
          busy={busy}
          disabled={tab === 'manifest' ? !chapters.length : !files.length}
        >
          <Upload size={16} />
          {tab === 'manifest' ? 'Import chapters' : 'Import chapter'}
        </Button>
      </form>
    </Modal>
  );
}
