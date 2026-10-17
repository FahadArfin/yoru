import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  ExternalLink,
  File,
  Focus,
  List,
  Maximize,
  MessageCircle,
  Plus,
  Scan,
  Settings2,
  Users,
  X,
} from 'lucide-react';
import { titleOf } from '../api';
import { Button, Modal } from '../components';
import { pageStep } from './model';

export default function ReaderMenu({
  media,
  chapter,
  chapters,
  page,
  total,
  preferences,
  setPrefs,
  previous,
  next,
  selectChapter,
  goPage,
  turn,
  close,
  fullscreen,
  openDialog,
  toggleFocus,
  bookmark,
  currentSaved,
  read,
  discussionUnit,
}) {
  const rtl = preferences.direction === 'rtl';
  const paged = ['single', 'double'].includes(preferences.mode);
  const pageArrow = (forward, Icon) => (
    <button
      aria-label={forward ? 'Next page' : 'Previous page'}
      title={forward ? 'Next page' : 'Previous page'}
      disabled={!chapter || pageStep(page, forward ? 1 : -1, total, preferences.mode) === page}
      onClick={() => turn(forward ? 1 : -1)}
    >
      <Icon size={18} />
    </button>
  );
  return (
    <div className="reader-menu-content">
      <div className="reader-menu-toolbar">
        {close && (
          <button aria-label="Close reader menu" onClick={close}>
            <X size={20} />
          </button>
        )}
        <button aria-label="Fullscreen" title="Fullscreen" onClick={fullscreen}>
          <Maximize size={18} />
        </button>
      </div>
      <Link className="reader-menu-title" to={`/title/${media.id}`}>
        <BookOpen size={19} />
        <span>{titleOf(media)}</span>
      </Link>
      <p className="reader-menu-chapter">
        <File size={18} />
        <span>
          {chapter?.title || (chapter ? `Chapter ${chapter.number}` : 'Your reading space')}
        </span>
      </p>
      <div className="reader-menu-navigation">
        <div className="reader-select-row">
          {pageArrow(rtl, ChevronLeft)}
          <label>
            <span>Page</span>
            <select
              aria-label="Page number"
              value={chapter ? page : ''}
              disabled={!chapter}
              onChange={(e) => goPage(e.target.value)}
            >
              {!chapter && <option value="">No pages loaded</option>}
              {Array.from({ length: total }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1} / {total}
                </option>
              ))}
            </select>
          </label>
          {pageArrow(!rtl, ChevronRight)}
        </div>
        <div className="reader-select-row">
          <button
            aria-label="Previous chapter"
            disabled={!previous}
            onClick={() => selectChapter(previous)}
          >
            <ChevronLeft size={18} />
          </button>
          <label>
            <span>Chapter</span>
            <select
              aria-label="Chapter selection"
              value={chapter?.id || ''}
              disabled={!chapters.length}
              onChange={(e) => selectChapter(chapters.find((item) => item.id === e.target.value))}
            >
              {!chapters.length && <option value="">No chapters loaded</option>}
              {chapters.map((item) => (
                <option key={item.id} value={item.id}>
                  Ch. {item.number}
                  {item.title ? ` · ${item.title}` : ''} · {item.language} · {item.group}
                </option>
              ))}
            </select>
          </label>
          <button aria-label="Next chapter" disabled={!next} onClick={() => selectChapter(next)}>
            <ChevronRight size={18} />
          </button>
        </div>
        <button
          className="reader-menu-action"
          aria-label="Chapters"
          onClick={() => openDialog('chapters')}
        >
          <List size={17} />
          All chapters & translations
        </button>
      </div>
      <div className="reader-menu-section">
        <Link
          className="reader-menu-action"
          aria-label={discussionUnit ? 'Chapter discussion' : 'Title discussion'}
          to={`/title/${media.id}?unit=${discussionUnit}`}
        >
          <MessageCircle size={17} />
          Discussion
        </Link>
        {chapter && (
          <div className="reader-edition-info">
            <span>Edition</span>
            <strong>
              <Users size={16} />
              {chapter.group}
            </strong>
          </div>
        )}
      </div>
      <div className="reader-menu-section reader-quick-settings">
        <label>
          <Columns2 size={17} />
          <select
            aria-label="Page layout"
            value={preferences.mode}
            onChange={(e) => setPrefs({ ...preferences, mode: e.target.value })}
          >
            <option value="single">Single page</option>
            <option value="double">Double page</option>
            <option value="vertical">Vertical scroll</option>
            <option value="webtoon">Webtoon scroll</option>
          </select>
        </label>
        <label>
          <Scan size={17} />
          <select
            aria-label="Page fit"
            value={preferences.fit}
            onChange={(e) => setPrefs({ ...preferences, fit: e.target.value })}
          >
            <option value="both" disabled={!paged}>
              Fit both
            </option>
            <option value="width">Fit width</option>
            <option value="height" disabled={!paged}>
              Fit height
            </option>
            <option value="original">Original size</option>
          </select>
        </label>
        <label>
          <ArrowLeftRight size={17} />
          <select
            aria-label="Page direction"
            value={preferences.direction}
            onChange={(e) => setPrefs({ ...preferences, direction: e.target.value })}
          >
            <option value="rtl">Right to left</option>
            <option value="ltr">Left to right</option>
          </select>
        </label>
        <button className="reader-menu-action" aria-label="Focus mode" onClick={toggleFocus}>
          <Focus size={17} />
          Hide controls
        </button>
        <button
          className="reader-menu-action"
          aria-label="Reader settings"
          onClick={() => openDialog('settings')}
        >
          <Settings2 size={17} />
          Reader settings
        </button>
      </div>
      <div className="reader-menu-section reader-menu-saved">
        <button
          className="reader-menu-action"
          aria-label={currentSaved.bookmark === page ? 'Remove bookmark' : 'Bookmark page'}
          aria-pressed={currentSaved.bookmark === page}
          disabled={!chapter}
          onClick={bookmark}
        >
          <Bookmark size={17} />
          {currentSaved.bookmark === page ? 'Bookmarked' : 'Bookmark page'}
        </button>
        <button
          className="reader-menu-action"
          aria-label={currentSaved.read ? 'Mark chapter unread' : 'Mark chapter read'}
          aria-pressed={Boolean(currentSaved.read)}
          disabled={!chapter}
          onClick={() => read(chapter, !currentSaved.read)}
        >
          <Check size={17} />
          {currentSaved.read ? 'Chapter read' : 'Mark chapter read'}
        </button>
        <button
          className="reader-menu-action"
          aria-label="Import more chapters"
          onClick={() => openDialog('import')}
        >
          <Plus size={17} />
          Add chapters
        </button>
        <button className="reader-menu-action" onClick={() => openDialog('sources')}>
          <ExternalLink size={17} />
          Reading sources
        </button>
      </div>
    </div>
  );
}

export function ReaderPagePicker({ page, total, goPage, close }) {
  const [draft, setDraft] = useState(String(page));
  const pick = (value) => {
    goPage(value);
    close();
  };
  return (
    <Modal title="Choose page" close={close}>
      <h2>Choose a page</h2>
      <form
        className="reader-jump-form"
        onSubmit={(e) => {
          e.preventDefault();
          pick(draft);
        }}
      >
        <label>
          Page number
          <input
            aria-label="Jump to page"
            type="number"
            min="1"
            max={total}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            required
          />
        </label>
        <Button type="submit">Go</Button>
      </form>
      <div className="reader-page-grid" aria-label="Pages">
        {Array.from({ length: total }, (_, i) => (
          <button
            key={i + 1}
            aria-current={page === i + 1 ? 'page' : undefined}
            onClick={() => pick(i + 1)}
            aria-label={`Go to page ${i + 1}`}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </Modal>
  );
}
