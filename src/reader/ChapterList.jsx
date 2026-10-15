import React, { useMemo, useState } from 'react';
import { ArrowDownUp, Bookmark, Check, BookOpen, Search } from 'lucide-react';
import { filterChapters, languageName, naturalCompare } from './model';

export default function ChapterList({ chapters, states = {}, currentId, onSelect, onRead }) {
  const [filters, setFilters] = useState({
    query: '',
    language: 'all',
    volume: 'all',
    status: 'all',
    sort: 'asc',
  });
  const [limit, setLimit] = useState(60);
  const change = (key, value) => {
    setFilters((old) => ({ ...old, [key]: value }));
    setLimit(60);
  };
  const rows = useMemo(
    () => filterChapters(chapters, filters, states),
    [chapters, filters, states],
  );
  const languages = [...new Set(chapters.map((chapter) => chapter.language))].sort();
  const volumes = [...new Set(chapters.map((chapter) => chapter.volume).filter(Boolean))].sort(
    naturalCompare,
  );
  return (
    <div className="chapter-browser">
      <div className="chapter-search">
        <Search size={16} />
        <input
          aria-label="Search chapters"
          placeholder="Find a chapter or edition…"
          value={filters.query}
          onChange={(e) => change('query', e.target.value)}
        />
        <button
          aria-label={filters.sort === 'asc' ? 'Newest chapter first' : 'Oldest chapter first'}
          title="Reverse chapter order"
          onClick={() => change('sort', filters.sort === 'asc' ? 'desc' : 'asc')}
        >
          <ArrowDownUp size={16} />
        </button>
      </div>
      <div className="chapter-filters">
        <select
          aria-label="Chapter language"
          value={filters.language}
          onChange={(e) => change('language', e.target.value)}
        >
          <option value="all">All languages</option>
          {languages.map((lang) => (
            <option key={lang} value={lang}>
              {languageName(lang)}
            </option>
          ))}
        </select>
        <select
          aria-label="Chapter status"
          value={filters.status}
          onChange={(e) => change('status', e.target.value)}
        >
          <option value="all">All chapters</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
          <option value="bookmarked">Bookmarked</option>
        </select>
        {volumes.length > 0 && (
          <select
            aria-label="Chapter volume"
            value={filters.volume}
            onChange={(e) => change('volume', e.target.value)}
          >
            <option value="all">All volumes</option>
            {volumes.map((volume) => (
              <option key={volume} value={volume}>
                Volume {volume}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="chapter-count">
        {rows.length} chapter {rows.length === 1 ? 'edition' : 'editions'}{' '}
        <span>Saved on this device</span>
      </p>
      <div className="chapter-rows">
        {rows.slice(0, limit).map((chapter) => {
          const saved = states[chapter.id] || {};
          return (
            <div
              className={`chapter-row ${currentId === chapter.id ? 'is-current' : ''} ${saved.read ? 'is-read' : ''}`}
              key={chapter.id}
            >
              <button
                className="chapter-select"
                aria-label={`Read chapter ${chapter.number} · ${chapter.group}`}
                onClick={() => onSelect(chapter, saved.bookmark || undefined)}
              >
                <span className="chapter-number">
                  {saved.bookmark ? (
                    <Bookmark size={15} fill="currentColor" />
                  ) : (
                    <BookOpen size={15} />
                  )}
                  <strong>{chapter.number}</strong>
                </span>
                <span className="chapter-copy">
                  <strong>{chapter.title || `Chapter ${chapter.number}`}</strong>
                  <small>
                    {chapter.group} · {languageName(chapter.language)}
                  </small>
                  <small>
                    {chapter.volume ? `Vol. ${chapter.volume} · ` : ''}
                    {chapter.pages.length} pages
                    {saved.bookmark ? ` · Bookmark p. ${saved.bookmark}` : ''}
                  </small>
                </span>
              </button>
              {onRead && (
                <button
                  className="chapter-read-toggle"
                  aria-label={`${saved.read ? 'Mark unread' : 'Mark read'} chapter ${chapter.number} · ${chapter.group}`}
                  aria-pressed={Boolean(saved.read)}
                  onClick={() => onRead(chapter, !saved.read)}
                >
                  <Check size={16} />
                </button>
              )}
            </div>
          );
        })}
        {!rows.length && (
          <div className="chapter-empty">
            <BookOpen size={24} />
            <strong>
              {chapters.length ? 'No chapters match these filters.' : 'Your chapters belong here.'}
            </strong>
            <p>
              {chapters.length
                ? 'Try another language or clear your search.'
                : 'Add a chapter manifest or your own page images to start reading in Yoru.'}
            </p>
          </div>
        )}
      </div>
      {rows.length > limit && (
        <button className="btn btn-subtle" onClick={() => setLimit((n) => n + 60)}>
          Show more chapters
        </button>
      )}
    </div>
  );
}
