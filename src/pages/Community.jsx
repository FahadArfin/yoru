import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, MessageCircle, Star, Users } from 'lucide-react';
import { ago, coverOf, isAnime, itemsOf, safeLink, titleOf } from '../api';
import { useApp, useResource } from '../state';
import { Avatar, Badge, Empty, ErrorNotice } from '../components';
import Chat from '../Chat';
export default function Community() {
  const resource = useResource('/api/community', false);
  const { online, event, config } = useApp();
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    if (['comments', 'reviews'].includes(event?.type)) resource.refresh();
  }, [event]);
  const feed = itemsOf(resource.data).filter((item) => filter === 'all' || item.kind === filter);
  return (
    <div className="page community-page">
      <div className="page-heading">
        <span className="eyebrow">PULL UP A CHAIR</span>
        <h1>Good stories. Better company.</h1>
        <p>For the theories you can’t keep to yourself, and the people who get it.</p>
      </div>
      <div className="community-banner">
        <span className="community-banner-icon">
          <Users size={38} />
        </span>
        <div>
          <h2>Welcome to the common room.</h2>
          <p>Anime fans. Manga readers. Manhwa obsessives. You’ll fit right in.</p>
        </div>
        <div className="community-online">
          <span className="live-dot" />
          <strong>{online.count || 0}</strong>
          <span>people online</span>
        </div>
      </div>
      <div className="community-layout">
        <section className="community-feed">
          <div className="section-heading">
            <h2>In the conversation</h2>
            <div className="segmented">
              {[
                ['all', 'All'],
                ['comment', 'Discussions'],
                ['review', 'Reviews'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={filter === key ? 'active' : ''}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {resource.error && <ErrorNotice message={resource.error} retry={resource.refresh} />}{' '}
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
                to={`/title/${item.mediaId}${item.unit ? `?unit=${item.unit}` : item.kind === 'review' ? '?tab=reviews' : ''}`}
              >
                {item.media && <img src={coverOf(item.media)} alt="" />}
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
                  : item.body}
              </p>
              <Link
                className="text-link"
                to={`/title/${item.mediaId}${item.unit ? `?unit=${item.unit}` : item.kind === 'review' ? '?tab=reviews' : ''}`}
              >
                {item.kind === 'review' ? <Star size={15} /> : <MessageCircle size={15} />}{' '}
                {item.kind === 'review' ? `${item.rating}/10 · Read review` : 'Add your take'}
                <ArrowRight size={14} />
              </Link>
            </article>
          ))}
          {!feed.length && !resource.loading && (
            <Empty
              icon={MessageCircle}
              title="We’re just getting started."
              action={
                <Link className="btn btn-primary" to="/browse/all">
                  Find a story to talk about
                  <ArrowRight size={16} />
                </Link>
              }
            >
              Watch something wonderful. Read something wild. Come back and tell us about it.
            </Empty>
          )}
        </section>
        <aside className="community-right">
          <Chat />
          <div className="panel online-panel">
            <div className="panel-heading">
              <span className="live-dot" />
              <h3>Here right now</h3>
              <span>{online.count || 0}</span>
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
