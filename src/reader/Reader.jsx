import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  ChevronRight,
  ExternalLink,
  List,
  Menu,
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
import { useReadingState } from './hooks';
import { useReaderChapters, rememberReadingSource } from './remote';
import { getReadingState, saveReadingState } from './storage';
import { chapterUnit, languageName, pageStep, readerLink, readerPreferences } from './model';
import ChapterList from './ChapterList';
import ReaderCanvas from './ReaderCanvas';
import ReaderImport from './ReaderImport';
import ReaderSettings from './ReaderSettings';
import ReaderMenu, { ReaderPagePicker } from './ReaderMenu';
import './reader.css';
import './reader-layout.css';

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
  const chapters = useReaderChapters(
    media,
    unit,
    params.get('chapter'),
    params.get('source'),
    params.get('language'),
  );
  const saved = useReadingState(media.id);
  const { entryFor, updateEntry, user } = useApp();
  const entry = entryFor(media.id);
  const [preferences, setPreferences] = useState(() =>
    readerPreferences(getReadingState(media.id).preferences, media.category),
  );
  const [dialog, setDialog] = useState('');
  const [focus, setFocus] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 901px)').matches);
  const [menuOpen, setMenuOpen] = useState(() => window.matchMedia('(min-width: 901px)').matches);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [page, setPage] = useState(1);
  const [jump, setJump] = useState(0);
  const [error, setError] = useState('');
  const [loadedChapter, setLoadedChapter] = useState('');
  const root = useRef();
  const menuToggle = useRef();
  const restoreMenuFocus = useRef(false);
  const requested = params.get('chapter');
  const chapter = requested
    ? chapters.items.find((item) => item.id === requested)
    : chapters.items.find((item) => item.number === String(unit)) || chapters.items[0];
  const currentSaved = chapter ? saved.chapters[chapter.id] || {} : {};
  const total = chapter?.pages.length || 0;
  useEffect(() => {
    const query = window.matchMedia('(min-width: 901px)');
    const resize = () => {
      setWide(query.matches);
      setMenuOpen(query.matches);
    };
    query.addEventListener('change', resize);
    return () => query.removeEventListener('change', resize);
  }, []);
  useEffect(() => setHeaderVisible(!chapter), [chapter?.id]);
  const hideControls = useCallback(() => {
    // Keep keyboard reading available when the focused control is about to disappear.
    if (
      root.current?.contains(document.activeElement) &&
      !root.current.querySelector('.reader-canvas')?.contains(document.activeElement)
    ) {
      root.current.querySelector('.reader-canvas')?.focus({ preventScroll: true });
    }
    setHeaderVisible(false);
    setMenuOpen(false);
  }, []);
  const toggleControls = useCallback(() => {
    if (headerVisible || menuOpen) hideControls();
    else setHeaderVisible(true);
  }, [headerVisible, menuOpen, hideControls]);
  const scrollDirection = useCallback(
    (direction) => {
      if (focus || dialogStack.length) return;
      if (direction === 'down') hideControls();
      else setHeaderVisible(true);
    },
    [focus, hideControls],
  );
  const closeMenu = () => {
    restoreMenuFocus.current = true;
    setMenuOpen(false);
    setHeaderVisible(true);
  };
  useLayoutEffect(() => {
    if (restoreMenuFocus.current && !menuOpen && headerVisible) {
      restoreMenuFocus.current = false;
      menuToggle.current?.focus({ preventScroll: true });
    }
  }, [menuOpen, headerVisible]);
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
    setJump((n) => n + 1);
    setLoadedChapter(chapter.id);
  }, [chapter?.id, params.get('page')]);
  useEffect(() => {
    if (!chapter || loadedChapter !== chapter.id) return;
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
    (direction) => {
      hideControls();
      goPage(pageStep(page, direction, total, preferences.mode));
    },
    [page, total, preferences.mode, goPage, hideControls],
  );
  const bookmark = useCallback(() => {
    if (chapter) write({}, chapter.id, { bookmark: currentSaved.bookmark === page ? null : page });
  }, [chapter?.id, page, currentSaved.bookmark, write]);
  const toggleFocus = useCallback(() => {
    setFocus((old) => !old);
    setHeaderVisible(true);
  }, []);
  const selectChapter = (next, startPage) => {
    if (!next) return;
    setDialog('');
    if (!wide) setMenuOpen(false);
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
        setHeaderVisible(true);
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
  const sourcePicker = chapters.sources.length > 0 && (
    <label className="reader-source-picker">
      <span>Reading source</span>
      <select
        aria-label="Reading source"
        value={chapters.source}
        onChange={(e) => {
          rememberReadingSource(media.id, e.target.value);
          setParams({ source: e.target.value });
        }}
      >
        {chapters.sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </select>
    </label>
  );
  const menu = (close) => (
    <ReaderMenu
      media={media}
      chapter={chapter}
      chapters={chapters.items}
      page={page}
      total={total}
      preferences={preferences}
      setPrefs={setPrefs}
      previous={chooseEdition(previous)}
      next={chooseEdition(next)}
      selectChapter={selectChapter}
      goPage={goPage}
      turn={turn}
      close={close}
      fullscreen={fullscreen}
      openDialog={setDialog}
      toggleFocus={toggleFocus}
      bookmark={bookmark}
      currentSaved={currentSaved}
      read={read}
      discussionUnit={hasChapterDiscussion ? numericChapter : 0}
      sourcePicker={sourcePicker}
    />
  );
  return (
    <section
      className={`comic-reader reader-dex ${focus ? 'reader-focus' : ''} ${wide && menuOpen && !focus ? 'reader-menu-open' : ''}`}
      data-background={preferences.background}
      ref={root}
    >
      <header
        className={`reader-top-header ${headerVisible && !focus ? '' : 'is-hidden'}`}
        aria-hidden={!headerVisible || focus}
        inert={!headerVisible || focus}
      >
        <div className="reader-top-title">
          <Link
            className="reader-exit"
            to={`/title/${media.id}`}
            aria-label={`Back to ${titleOf(media)}`}
          >
            <ArrowLeft size={19} />
          </Link>
          <div>
            <strong>
              {chapter?.title || (chapter ? `Chapter ${chapter.number}` : 'Your reading space')}
            </strong>
            <Link to={`/title/${media.id}`}>{titleOf(media)}</Link>
          </div>
        </div>
        <nav className="reader-quick-bar" aria-label="Reader navigation">
          <button onClick={() => setDialog('chapters')} aria-label="Choose chapter">
            {chapter ? `Ch. ${chapter.number}` : 'Chapters'}
            <ChevronRight size={14} />
          </button>
          <button disabled={!chapter} onClick={() => setDialog('pages')} aria-label="Choose page">
            Pg. {chapter ? page : '—'} / {total || '—'}
            <ChevronRight size={14} />
          </button>
          <button
            ref={menuToggle}
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="Reader menu"
            aria-expanded={menuOpen}
          >
            <span>Menu</span>
            <Menu size={16} />
          </button>
        </nav>
        {chapter && (
          <div className="reader-top-edition">
            {chapter.group} · {languageName(chapter.language)}
          </div>
        )}
      </header>
      <div className="reader-body">
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
              onToggleControls={toggleControls}
              onScrollDirection={scrollDirection}
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
                {chapters.error
                  ? 'This chapter couldn’t load.'
                  : requested
                    ? 'This edition is unavailable.'
                    : 'A story worth settling into.'}
              </h1>
              <p>
                {requested
                  ? 'Try another source, choose a saved chapter, or retry this edition.'
                  : 'Choose a reading source or open your own pages. Your layout, bookmarks and place are remembered here.'}
              </p>
              {sourcePicker}
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
      {wide && menuOpen && !focus && (
        <aside className="reader-side-menu" aria-label="Reader menu">
          {menu(closeMenu)}
        </aside>
      )}
      {!wide && menuOpen && !focus && !dialog && (
        <Modal title="Reader menu" close={closeMenu}>
          {menu()}
        </Modal>
      )}
      {!headerVisible && !focus && (!wide || !menuOpen) && (
        <button
          className="reader-reveal-controls"
          aria-label="Show chapter and page controls"
          onClick={() => setHeaderVisible(true)}
        >
          <List size={16} />
          {chapter ? `Ch. ${chapter.number} · Pg. ${page}/${total}` : 'Reader controls'}
          <Menu size={16} />
        </button>
      )}
      {focus && (
        <button className="reader-leave-focus" onClick={() => setFocus(false)}>
          <X size={16} />
          Show controls
        </button>
      )}
      {dialog === 'settings' && (
        <ReaderSettings preferences={preferences} onChange={setPrefs} close={() => setDialog('')} />
      )}
      {dialog === 'pages' && chapter && (
        <ReaderPagePicker page={page} total={total} goPage={goPage} close={() => setDialog('')} />
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
            remote={chapters.remote}
            loading={chapters.loading}
            language={chapters.remote ? chapters.language : undefined}
            languages={chapters.languages}
            onLanguageChange={
              chapters.remote
                ? (language) => setParams({ source: chapters.source, language })
                : undefined
            }
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
