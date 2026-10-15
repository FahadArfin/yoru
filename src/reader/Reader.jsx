import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Focus,
  List,
  Maximize,
  MessageCircle,
  Plus,
  Settings2,
  X,
} from 'lucide-react';
import { coverOf, safeLink, titleOf } from '../api';
import { useApp, useResource } from '../state';
import { Button, ErrorNotice, Loading, Modal } from '../components';
import { dialogStack } from '../overlays';
import { recordView } from '../watch-views';
import { setWatchPage } from '../webmcp-state';
import { useChapters, useReadingState } from './hooks';
import { getReadingState, saveReadingState } from './storage';
import { chapterUnit, languageName, pageStep, readerLink, readerPreferences } from './model';
import ChapterList from './ChapterList';
import ReaderCanvas from './ReaderCanvas';
import ReaderImport from './ReaderImport';
import ReaderSettings from './ReaderSettings';
import './reader.css';

function ReadingSources({ media, close }) {
  const { notify } = useApp();
  const [url, setUrl] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`yoru:source:${media.id}`))?.url || '';
    } catch {
      return '';
    }
  });
  const [error, setError] = useState('');
  const sources = (media.externalLinks || []).filter(
    (item) => item.type === 'reading' && safeLink(item.url),
  );
  return (
    <Modal title="Reading sources" close={close}>
      <span className="eyebrow">FIND YOUR NEXT CHAPTER</span>
      <h2>Read with a provider.</h2>
      <p className="muted">
        Provider readers open in their own tab. Save your reading progress when you return.
      </p>
      <div className="reader-provider-list">
        {sources.map((item, index) => (
          <a key={index} href={safeLink(item.url)} target="_blank" rel="noreferrer">
            {item.label || 'Publisher'}
            <ExternalLink size={16} />
          </a>
        ))}
        <a
          href={`https://mangadex.org/titles?q=${encodeURIComponent(titleOf(media))}`}
          target="_blank"
          rel="noreferrer"
        >
          Search on MangaDex
          <ExternalLink size={16} />
        </a>
      </div>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          if (!safeLink(url)) {
            setError('Enter a complete HTTP or HTTPS reading link.');
            return;
          }
          try {
            localStorage.setItem(
              `yoru:source:${media.id}`,
              JSON.stringify({ url: safeLink(url), kind: 'external' }),
            );
            notify('Reading link saved on this device');
          } catch {
            setError('This browser could not save the reading link.');
          }
        }}
      >
        <label>
          Your reading link
          <input
            type="url"
            aria-label="Your reading link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            required
          />
        </label>
        <div className="reader-actions">
          <Button type="submit" variant="secondary">
            Save link
          </Button>
          {safeLink(url) && (
            <a className="btn btn-subtle" href={safeLink(url)} target="_blank" rel="noreferrer">
              Open link
              <ExternalLink size={14} />
            </a>
          )}
        </div>
        {error && <ErrorNotice message={error} />}
      </form>
    </Modal>
  );
}

function ReaderSession({ media, unit }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const chapters = useChapters(media.id);
  const saved = useReadingState(media.id);
  const { entryFor, updateEntry, user } = useApp();
  const entry = entryFor(media.id);
  const [preferences, setPreferences] = useState(() =>
    readerPreferences(getReadingState(media.id).preferences, media.category),
  );
  const [dialog, setDialog] = useState('');
  const [focus, setFocus] = useState(false);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState('1');
  const [jump, setJump] = useState(0);
  const [error, setError] = useState('');
  const [loadedChapter, setLoadedChapter] = useState('');
  const root = useRef();
  const requested = params.get('chapter');
  const chapter = requested
    ? chapters.items.find((item) => item.id === requested)
    : chapters.items.find((item) => item.number === String(unit)) || chapters.items[0];
  const currentSaved = chapter ? saved.chapters[chapter.id] || {} : {};
  const total = chapter?.pages.length || 0;
  const numericChapter = chapterUnit(chapter ? chapter.number : unit);
  const hasChapterDiscussion = Number.isInteger(numericChapter) && numericChapter > 0;
  const write = useCallback(
    (patch, chapterId, chapterPatch) => {
      try {
        return saveReadingState(media.id, patch, chapterId, chapterPatch);
      } catch (error) {
        setError(error.message);
        return null;
      }
    },
    [media.id],
  );
  useEffect(() => {
    if (!chapter) {
      setLoadedChapter('');
      return;
    }
    const stored = getReadingState(media.id).chapters[chapter.id];
    const next = Math.max(
      1,
      Math.min(
        chapter.pages.length,
        Math.trunc(Number(params.get('page')) || Number(stored?.page) || 1),
      ),
    );
    if (loadedChapter === chapter.id && page === next) return;
    setPage(next);
    setDraft(String(next));
    setJump((n) => n + 1);
    setLoadedChapter(chapter.id);
  }, [chapter?.id, params.get('page')]);
  useEffect(() => {
    if (!chapter || loadedChapter !== chapter.id) return;
    setDraft(String(page));
    write(
      {
        title: titleOf(media),
        cover: coverOf(media),
        category: media.category,
        lastChapter: chapter.id,
        number: chapter.number,
      },
      chapter.id,
      { page },
    );
  }, [chapter?.id, loadedChapter, page, media, write]);
  useEffect(() => {
    let recorded = false;
    const record = () => {
      if (!recorded && !document.hidden) {
        recorded = true;
        recordView(media.id, true).catch(() => {});
      }
    };
    record();
    document.addEventListener('visibilitychange', record);
    return () => document.removeEventListener('visibilitychange', record);
  }, [media.id]);
  useEffect(() => {
    document.title = `${chapter ? `Ch. ${chapter.number} · ` : ''}${titleOf(media)} · Yoru Reader`;
    setWatchPage({
      path: window.location.pathname,
      mediaId: media.id,
      title: titleOf(media),
      unit: numericChapter,
      category: media.category,
      language: chapter?.language || null,
      source: null,
      sources: [],
      controlSupported: false,
      loadingSources: false,
    });
    return () => {
      setWatchPage(null);
      document.title = 'Yoru · A little more obsessed';
    };
  }, [media, chapter?.id, unit]);
  const updatePage = useCallback(
    (value, scroll = true) => {
      const next = Math.max(1, Math.min(total, Math.trunc(Number(value) || 1)));
      setPage(next);
      setParams(
        (old) => {
          const updated = new URLSearchParams(old);
          updated.set('page', String(next));
          return updated;
        },
        { replace: true },
      );
      if (scroll) setJump((n) => n + 1);
    },
    [total, setParams],
  );
  const goPage = useCallback((value) => updatePage(value), [updatePage]);
  const visiblePage = useCallback(
    (value) => {
      if (value !== page) updatePage(value, false);
    },
    [page, updatePage],
  );
  const turn = useCallback(
    (direction) => goPage(pageStep(page, direction, total, preferences.mode)),
    [page, total, preferences.mode, goPage],
  );
  const bookmark = useCallback(() => {
    if (chapter) write({}, chapter.id, { bookmark: currentSaved.bookmark === page ? null : page });
  }, [chapter?.id, page, currentSaved.bookmark, write]);
  const toggleFocus = useCallback(() => setFocus((old) => !old), []);
  const selectChapter = (next, startPage) => {
    setDialog('');
    navigate(readerLink(media.id, next, startPage));
  };
  // Stay in the same language, favor the same edition, and skip alternative releases of the current number.
  const siblings = chapter
    ? chapters.items.filter(
        (item) =>
          item.language === chapter.language &&
          (item.number !== chapter.number || item.volume !== chapter.volume),
      )
    : [];
  const currentIndex = chapter ? chapters.items.findIndex((item) => item.id === chapter.id) : -1;
  const previous = siblings.filter((item) => chapters.items.indexOf(item) < currentIndex).at(-1);
  const next = siblings.find((item) => chapters.items.indexOf(item) > currentIndex);
  const chooseEdition = (candidate) =>
    candidate &&
    (chapters.items.find(
      (item) =>
        item.number === candidate.number &&
        item.volume === candidate.volume &&
        item.language === candidate.language &&
        item.group === chapter.group,
    ) ||
      candidate);
  useEffect(() => {
    const onKey = (event) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        dialogStack.length ||
        event.target.closest('input,textarea,select,button,a,[contenteditable="true"]')
      )
        return;
      if (event.key === 'Escape') {
        setFocus(false);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        setDialog('settings');
      } else if (key === 'f') {
        event.preventDefault();
        toggleFocus();
      } else if (key === 'b') {
        event.preventDefault();
        bookmark();
      } else if (chapter && ['ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
        event.preventDefault();
        turn(
          event.key === ' '
            ? event.shiftKey
              ? -1
              : 1
            : (event.key === 'ArrowRight' ? 1 : -1) * (preferences.direction === 'rtl' ? -1 : 1),
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chapter?.id, preferences.direction, turn, bookmark, toggleFocus]);
  const setPrefs = (next) => {
    const clean = readerPreferences(next, media.category);
    setPreferences(clean);
    write({ preferences: clean });
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current.requestFullscreen();
    } catch {
      setFocus(true);
    }
  };
  const read = (item, value) => write({}, item.id, { read: value });
  const openImport = () => setDialog('import');
  return (
    <section
      className={`comic-reader ${focus ? 'reader-focus' : ''}`}
      data-background={preferences.background}
      ref={root}
    >
      <header className="reader-header">
        <Link
          className="reader-back"
          to={`/title/${media.id}`}
          aria-label={`Back to ${titleOf(media)}`}
        >
          <ArrowLeft size={19} />
          <img src="/icon.svg" alt="Yoru" />
        </Link>
        <div className="reader-heading">
          <Link to={`/title/${media.id}`}>{titleOf(media)}</Link>
          <span>
            {chapter
              ? `Chapter ${chapter.number}${chapter.title ? ` · ${chapter.title}` : ''}`
              : 'Your reading space'}
          </span>
        </div>
        <div className="reader-header-actions">
          <button aria-label="Chapters" title="Chapters" onClick={() => setDialog('chapters')}>
            <List size={20} />
            <span>Chapters</span>
          </button>
          <button
            aria-label="Reader settings"
            title="Reader settings"
            onClick={() => setDialog('settings')}
          >
            <Settings2 size={20} />
          </button>
          <button
            aria-label="Focus mode"
            title="Focus mode (F)"
            aria-pressed={focus}
            onClick={toggleFocus}
          >
            <Focus size={20} />
          </button>
          <button
            className="reader-fullscreen"
            aria-label="Fullscreen"
            title="Fullscreen"
            onClick={fullscreen}
          >
            <Maximize size={19} />
          </button>
        </div>
      </header>
      <div className="reader-body">
        {!focus && (
          <aside className="reader-desktop-rail">
            <div className="reader-rail-title">
              <span>CHAPTERS</span>
              <button aria-label="Import more chapters" title="Add chapters" onClick={openImport}>
                <Plus size={18} />
              </button>
            </div>
            <ChapterList
              chapters={chapters.items}
              states={saved.chapters}
              currentId={chapter?.id}
              onSelect={selectChapter}
              onRead={read}
            />
            <button className="reader-source-link" onClick={() => setDialog('sources')}>
              Reading sources
              <ExternalLink size={14} />
            </button>
          </aside>
        )}
        <div className="reader-stage">
          {error && (
            <div className="reader-warning" role="status">
              {error}
              <button aria-label="Dismiss notice" onClick={() => setError('')}>
                <X size={14} />
              </button>
            </div>
          )}
          {chapters.loading ? (
            <Loading />
          ) : chapter && loadedChapter === chapter.id ? (
            <ReaderCanvas
              key={chapter.id}
              chapter={chapter}
              page={page}
              preferences={preferences}
              jump={jump}
              onVisiblePage={visiblePage}
              onTurn={turn}
              onToggleFocus={toggleFocus}
            />
          ) : (
            <div className="reader-welcome">
              <div className="reader-welcome-art">
                <img src={coverOf(media)} alt="" />
                <span>
                  <BookOpen size={30} />
                </span>
              </div>
              <span className="eyebrow">
                {media.category === 'MANHWA'
                  ? 'ONE SCROLL. ANOTHER WORLD.'
                  : 'JUST YOU AND THE NEXT PAGE.'}
              </span>
              <h1>
                {requested ? 'This chapter isn’t on this device.' : 'A story worth settling into.'}
              </h1>
              <p>
                {requested
                  ? 'Choose a saved chapter or import the edition this link belongs to.'
                  : 'Read with a publisher, or open your own pages in Yoru. Your layout, bookmarks and place are remembered here.'}
              </p>
              {chapters.error && <ErrorNotice message={chapters.error} retry={chapters.refresh} />}
              <div className="reader-actions">
                <Button onClick={() => setDialog('sources')}>
                  <ExternalLink size={16} />
                  Reading sources
                </Button>
                <Button variant="secondary" onClick={openImport}>
                  <Plus size={16} />
                  Add chapters
                </Button>
              </div>
              <div className="reader-welcome-features">
                <span>
                  <BookOpen size={16} />
                  Paged & webtoon
                </span>
                <span>
                  <Bookmark size={16} />
                  Save your place
                </span>
                <span>
                  <Settings2 size={16} />
                  Make it yours
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      <footer className="reader-controls">
        <div className="reader-chapter-controls">
          <button
            aria-label="Previous chapter"
            title="Previous chapter"
            disabled={!previous}
            onClick={() => selectChapter(chooseEdition(previous))}
          >
            <ChevronLeft size={18} />
          </button>
          <button className="reader-chapter-label" onClick={() => setDialog('chapters')}>
            {chapter ? `Ch. ${chapter.number}` : 'Chapters'}
          </button>
          <button
            aria-label="Next chapter"
            title="Next chapter"
            disabled={!next}
            onClick={() => selectChapter(chooseEdition(next))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="reader-page-controls">
          <button
            aria-label="Previous page"
            title="Previous page"
            disabled={!chapter || page <= 1}
            onClick={() => turn(-1)}
          >
            <ArrowLeft size={18} />
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              goPage(draft);
            }}
          >
            <label>
              <span className="sr-only">Page number</span>
              <input
                aria-label="Page number"
                type="number"
                min="1"
                max={total || 1}
                value={draft}
                disabled={!chapter}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (chapter) goPage(draft);
                }}
              />
            </label>
            <span>/ {total || '—'}</span>
          </form>
          <button
            aria-label="Next page"
            title="Next page"
            disabled={!chapter || page >= total}
            onClick={() => turn(1)}
          >
            <ArrowRight size={18} />
          </button>
        </div>
        <div className="reader-extra-controls">
          <button
            aria-label={currentSaved.bookmark === page ? 'Remove bookmark' : 'Bookmark page'}
            title="Bookmark page (B)"
            disabled={!chapter}
            aria-pressed={currentSaved.bookmark === page}
            onClick={bookmark}
          >
            <Bookmark size={18} fill={currentSaved.bookmark === page ? 'currentColor' : 'none'} />
          </button>
          <button
            aria-label={currentSaved.read ? 'Mark chapter unread' : 'Mark chapter read'}
            title="Mark read"
            aria-pressed={Boolean(currentSaved.read)}
            disabled={!chapter}
            onClick={() => read(chapter, !currentSaved.read)}
          >
            <Check size={19} />
          </button>
          <Link
            title={hasChapterDiscussion ? 'Chapter discussion' : 'Title discussion'}
            aria-label={hasChapterDiscussion ? 'Chapter discussion' : 'Title discussion'}
            to={`/title/${media.id}?unit=${hasChapterDiscussion ? numericChapter : 0}`}
          >
            <MessageCircle size={18} />
          </Link>
        </div>
      </footer>
      {focus && (
        <button className="reader-leave-focus" onClick={() => setFocus(false)}>
          <X size={16} />
          Show controls
        </button>
      )}
      {dialog === 'settings' && (
        <ReaderSettings preferences={preferences} onChange={setPrefs} close={() => setDialog('')} />
      )}
      {dialog === 'import' && (
        <ReaderImport
          media={media}
          initialNumber={String(unit)}
          close={() => setDialog('')}
          onImport={(items, selected) => {
            chapters.setItems(items);
            selectChapter(selected, 1);
          }}
        />
      )}
      {dialog === 'sources' && <ReadingSources media={media} close={() => setDialog('')} />}
      {dialog === 'chapters' && (
        <Modal title="Chapters" close={() => setDialog('')} wide>
          <span className="eyebrow">PICK UP YOUR STORY</span>
          <h2>{titleOf(media)}</h2>
          <ChapterList
            chapters={chapters.items}
            states={saved.chapters}
            currentId={chapter?.id}
            onSelect={selectChapter}
            onRead={read}
          />
          <div className="reader-actions">
            <Button variant="secondary" onClick={openImport}>
              <Plus size={16} />
              Add chapters
            </Button>
            <Button variant="subtle" onClick={() => setDialog('sources')}>
              Reading sources
              <ExternalLink size={14} />
            </Button>
          </div>
          <div className="reader-account-note">
            <span>Page position and bookmarks are saved on this device.</span>
            <Button
              variant="subtle"
              disabled={numericChapter === null}
              onClick={() =>
                updateEntry(media, {
                  status: 'reading',
                  progress: Math.max(entry?.progress || 0, numericChapter),
                })
              }
            >
              {user ? 'Save chapter to my library' : 'Sign in to track across devices'}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

export default function Reader() {
  const { id, unit } = useParams();
  const resource = useResource(`/api/media/${id}`);
  const media = resource.data?.media || resource.data;
  if (resource.loading) return <Loading />;
  if (resource.error || !media)
    return (
      <div className="page">
        <ErrorNotice
          message={resource.error || 'This title could not be found.'}
          retry={resource.refresh}
        />
      </div>
    );
  if (!['MANGA', 'MANHWA'].includes(media.category))
    return (
      <div className="page">
        <h1>This title belongs in the anime player.</h1>
        <Link className="btn btn-primary" to={`/watch/${id}/${unit || 1}`}>
          Open anime player
        </Link>
      </div>
    );
  return <ReaderSession key={id} media={media} unit={unit} />;
}
