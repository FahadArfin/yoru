import React, { useEffect, useState } from 'react';
import { Link } from '../collection-router';
import { ArrowRight, MessageCircle, Star, Users } from 'lucide-react';
import { ago, isAnime, itemsOf, safeLink, titleOf } from '../api';
import { useApp, useResource } from '../state';
import { Avatar, Badge, Empty, ErrorNotice } from '../components';
import Chat from '../Chat';
import Forum from '../Forum';
import CoverImage from '../CoverImage';
import '../section-pages.css';
import { commentPreview } from '../../shared/comment-media';
export default function Community() {
  const resource = useResource('/api/community', false);
  const { visitors, event, config } = useApp();
  const connected = visitors.connected;
  const online = connected ? visitors.data : { count: 0, users: [] };
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('forums');
  useEffect(() => {
    if (['comments', 'reviews', 'snapshot'].includes(event?.type)) resource.refresh();
  }, [event]);
  const feed = itemsOf(resource.data).filter((item) => filter === 'all' || item.kind === filter);
  return (
    <div className="page section-page community-page">
      <header className="section-page-heading">
        <div>
          <span className="section-kicker">
            <MessageCircle size={13} /> BETWEEN EPISODES & CHAPTERS
          </span>
          <h1>Community</h1>
          <p>Good stories. Better company. Share what you’re watching and reading.</p>
        </div>
        <div className="section-heading-note">
          <span className={`live-dot ${!connected ? 'muted-dot' : ''}`} />{' '}
          {connected ? `${online.count || 0} online` : 'Connecting to the community'}
        </div>
      </header>
      {view === 'activity' && (
        <div className="community-banner">
          <span className="community-banner-icon">
            <Users size={24} />
          </span>
          <div>
            <h2>A shared story is a better story.</h2>
            <p>Meet in a room, watch together, or turn the next chapter with a friend.</p>
          </div>
          <Link className="section-action" to="/rooms">
            Find a room <ArrowRight size={15} />
          </Link>
        </div>
      )}
      <div className="segmented community-view-tabs" role="group" aria-label="Community view">
        <button
          className={view === 'forums' ? 'active' : ''}
          aria-pressed={view === 'forums'}
          onClick={() => setView('forums')}
        >
          Forums
        </button>
        <button
          className={view === 'activity' ? 'active' : ''}
          aria-pressed={view === 'activity'}
          onClick={() => setView('activity')}
        >
          Latest activity
        </button>
      </div>
      <div className="community-layout">
        {view === 'forums' ? (
          <Forum />
        ) : (
          <section className="community-feed">
            <div className="section-heading">
              <h2>Latest conversations</h2>
              <div className="segmented" role="group" aria-label="Conversation type">
                {[
                  ['all', 'All'],
                  ['comment', 'Discussions'],
                  ['review', 'Reviews'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={filter === key ? 'active' : ''}
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {resource.error && <ErrorNotice message={resource.error} retry={resource.refresh} />}
            {resource.loading && !feed.length && (
              <div className="section-loading" role="status" aria-label="Loading conversations">
                <span className="sr-only">Loading conversations…</span>
                {Array.from({ length: 3 }, (_, index) => (
                  <div className="section-skeleton" key={index}>
                    <span />
                    <div>
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {feed.map((item) => (
              <article className="feed-card" key={item.id}>
                <div className="feed-byline">
                  <Avatar user={item.author} />
                  <div>
                    <strong>{item.author?.name}</strong>
                    <small>{ago(item.createdAt)}</small>
                  </div>
                  <Badge>{item.kind === 'review' ? 'REVIEW' : 'DISCUSSION'}</Badge>
                </div>
                <Link
                  className="feed-title-link"
                  to={
                    item.unit
                      ? `/community/${item.mediaId}/${item.unit}`
                      : `/title/${item.mediaId}${item.kind === 'review' ? '?tab=reviews' : ''}`
                  }
                >
                  {item.media && <CoverImage media={item.media} alt="" />}
                  <div>
                    <span className="eyebrow">
                      {item.unit
                        ? `${isAnime(item.media) ? 'EPISODE' : 'CHAPTER'} ${item.unit}`
                        : 'THE WHOLE STORY'}
                    </span>
                    <h3>{item.title || titleOf(item.media)}</h3>
                    <span>{item.title ? titleOf(item.media) : 'Join the discussion'}</span>
                  </div>
                  <ArrowRight size={18} />
                </Link>
                <p className={item.spoiler ? 'feed-spoiler' : ''}>
                  {item.spoiler
                    ? 'Spoilers inside. Open the discussion to read this take.'
                    : item.kind === 'comment'
                      ? commentPreview(item.body)
                      : item.body}
                </p>
                <Link
                  className="text-link"
                  to={
                    item.unit
                      ? `/community/${item.mediaId}/${item.unit}`
                      : `/title/${item.mediaId}${item.kind === 'review' ? '?tab=reviews' : ''}`
                  }
                >
                  {item.kind === 'review' ? <Star size={15} /> : <MessageCircle size={15} />}{' '}
                  {item.kind === 'review' ? `${item.rating}/10 · Read review` : 'Add your take'}
                  <ArrowRight size={14} />
                </Link>
              </article>
            ))}
            {!feed.length && !resource.loading && !resource.error && (
              <Empty
                icon={MessageCircle}
                title={
                  filter === 'all'
                    ? 'Every conversation starts with a story.'
                    : filter === 'review'
                      ? 'No reviews here yet.'
                      : 'No discussions here yet.'
                }
                action={
                  <Link className="btn btn-primary" to="/browse/all">
                    Find a story to talk about
                    <ArrowRight size={16} />
                  </Link>
                }
              >
                Open a title to share a theory, leave a review, or join an episode or chapter
                discussion.
              </Empty>
            )}
          </section>
        )}
        <aside className="community-right">
          {view === 'forums' && (
            <Link className="forum-room-link" to="/rooms">
              <Users size={18} /> Watch together <ArrowRight size={15} />
            </Link>
          )}
          <Chat />
          <div className="panel online-panel">
            <div className="panel-heading">
              <span className="live-dot" />
              <h3>Here right now</h3>
              <span>{connected ? online.count || 0 : '—'}</span>
            </div>
            {(online.users || []).map((user) => (
              <div className="online-person" key={user.id}>
                <Avatar user={user} size="small" />
                <strong>{user.name}</strong>
                <span className="live-dot" />
              </div>
            ))}
            {!online.users?.length && (
              <p className="muted">Signed-in members appear here while they’re online.</p>
            )}
          </div>
          {safeLink(config.discordInviteUrl) && (
            <a
              className="discord-card"
              href={safeLink(config.discordInviteUrl)}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={26} />
              <strong>The conversation continues.</strong>
              <span>
                Join us on Discord <ArrowRight size={16} />
              </span>
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}
