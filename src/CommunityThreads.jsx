import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, MessageCircle, Play } from 'lucide-react';
import { ago, itemsOf, titleOf } from './api';
import { useApp, useResource } from './state';
import { ErrorNotice } from './components';
import CoverImage from './CoverImage';
import './community-threads.css';

export default function CommunityThreads() {
  const [category, setCategory] = useState('anime');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(9);
  const { event } = useApp();
  const resource = useResource(`/api/community/threads?category=${category}`, false);
  useEffect(() => {
    if (['comments', 'snapshot'].includes(event?.type)) resource.refresh();
  }, [event]);
  useEffect(() => {
    setLimit(9);
  }, [category, query]);
  const items = itemsOf(resource.data).filter((thread) =>
    titleOf(thread.media).toLowerCase().includes(query.toLowerCase()),
  );
  const anime = category === 'anime';
  return (
    <section className="community-threads" aria-label="Episode and chapter threads">
      <div className="section-heading">
        <div>
          <span className="section-kicker">ONE RELEASE. ONE CONVERSATION.</span>
          <h2>Episode & chapter discussions</h2>
        </div>
        <div className="segmented" role="group" aria-label="Discussion category">
          {['anime', 'manga', 'manhwa'].map((kind) => (
            <button
              key={kind}
              aria-pressed={category === kind}
              className={category === kind ? 'active' : ''}
              onClick={() => setCategory(kind)}
            >
              {kind === 'anime' ? 'Anime' : kind === 'manga' ? 'Manga' : 'Manhwa'}
            </button>
          ))}
        </div>
      </div>
      <div className="thread-toolbar">
        <p>
          Recent releases and active conversations. The same discussion you’ll find while watching
          or reading.
        </p>
        <input
          type="search"
          aria-label="Search discussion threads"
          placeholder="Find a discussion…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {resource.error && <ErrorNotice message={resource.error} retry={resource.refresh} />}
      {resource.loading && !resource.data && <p role="status">Finding discussions…</p>}
      {resource.data?.releaseState && resource.data.releaseState !== 'ready' && (
        <p className="muted">
          Recent releases may be delayed. Existing discussions are still available.
        </p>
      )}
      <div className="release-thread-grid" aria-busy={resource.loading}>
        {items.slice(0, limit).map((thread) => (
          <article className="release-thread" key={thread.id}>
            <CoverImage media={thread.media} alt="" />
            <div className="release-thread-body">
              <span className="eyebrow">
                {anime ? 'Episode' : 'Chapter'} {thread.unit}
              </span>
              <Link
                className="release-thread-title"
                to={`/community/${thread.mediaId}/${thread.unit}`}
              >
                <h3>{titleOf(thread.media)}</h3>
                <ArrowRight size={16} />
              </Link>
              <small>
                {thread.comments ? `Active ${ago(thread.latest)}` : 'Be the first to join'}
              </small>
              <div className="release-thread-links">
                <Link to={`/community/${thread.mediaId}/${thread.unit}`}>
                  <MessageCircle size={14} />
                  {thread.comments} {thread.comments === 1 ? 'comment' : 'comments'}
                </Link>
                <Link to={`/${anime ? 'watch' : 'read'}/${thread.mediaId}/${thread.unit}`}>
                  {anime ? <Play size={13} /> : <BookOpen size={13} />} {anime ? 'Watch' : 'Read'}
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!resource.loading && !resource.error && !items.length && (
        <p className="thread-empty">
          {query
            ? 'No matching discussions. Try another title.'
            : 'No recent threads here yet. A discussion opens automatically with a supported release, or when someone comments on an episode or chapter.'}
        </p>
      )}
      {items.length > limit && (
        <button className="btn" onClick={() => setLimit((value) => value + 9)}>
          Show more discussions
        </button>
      )}
    </section>
  );
}
