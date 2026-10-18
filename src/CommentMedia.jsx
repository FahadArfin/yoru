import React, { useEffect, useState } from 'react';
import { commentParts, gifUrl } from '../shared/comment-media';

const emoji = [
  '😀',
  '😂',
  '🤣',
  '🥹',
  '😍',
  '🥰',
  '😭',
  '😤',
  '🤯',
  '😱',
  '😎',
  '🤔',
  '🫡',
  '😴',
  '💀',
  '👀',
  '🔥',
  '❤️',
  '💔',
  '✨',
  '👏',
  '🙌',
  '👍',
  '👎',
  '💯',
  '🎉',
  '🍿',
  '🫶',
  '🤝',
  '🙏',
  '😅',
  '🤩',
];
let cachedEmotes;
let emoteRequest;
function loadEmotes() {
  if (cachedEmotes) return Promise.resolve(cachedEmotes);
  if (!emoteRequest)
    emoteRequest = fetch('https://api.frankerfacez.com/v1/set/global', {
      signal: AbortSignal.timeout(10000),
      credentials: 'omit',
    })
      .then((response) => {
        if (!response.ok) throw new Error('Emotes are unavailable right now.');
        return response.json();
      })
      .then((data) => {
        const unique = new Map();
        for (const id of data.default_sets || []) {
          for (const item of data.sets?.[id]?.emoticons || []) {
            if (/^[1-9]\d{0,9}$/.test(String(item.id)) && /^[A-Za-z0-9_]{1,60}$/.test(item.name))
              unique.set(item.id, { id: item.id, name: item.name });
          }
        }
        if (!unique.size) throw new Error('No emotes are available right now.');
        cachedEmotes = [...unique.values()];
        return cachedEmotes;
      })
      .finally(() => {
        emoteRequest = null;
      });
  return emoteRequest;
}
function MediaImage({ src, alt, className }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="comment-media-unavailable">{alt} · unavailable</span>
  ) : (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
export function CommentBody({ body }) {
  return (
    <div className="comment-body">
      {commentParts(body).map((part, index) =>
        part.type === 'text' ? (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        ) : (
          <MediaImage
            key={`${index}-${part.url}`}
            src={part.url}
            alt={part.type === 'gif' ? 'Comment GIF' : part.name}
            className={part.type === 'gif' ? 'comment-gif' : 'comment-emote'}
          />
        ),
      )}
    </div>
  );
}
export function CommentMediaPicker({ tab, onInsert, onGif, close }) {
  const [emotes, setEmotes] = useState(cachedEmotes || []);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [url, setUrl] = useState('');
  const validGif = gifUrl(url);
  useEffect(() => {
    if (tab !== 'emotes') return;
    let active = true;
    setLoading(true);
    setError('');
    loadEmotes()
      .then((items) => {
        if (active) setEmotes(items);
      })
      .catch(() => {
        if (active) setError('FrankerFaceZ emotes are temporarily unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, retry]);
  return (
    <div
      className="comment-media-picker"
      role="region"
      aria-label={`${tab === 'gif' ? 'GIF' : tab === 'emotes' ? 'FrankerFaceZ emote' : 'Emoji'} picker`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault();
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="comment-picker-heading">
        <strong>
          {tab === 'gif'
            ? 'Attach a GIF'
            : tab === 'emotes'
              ? 'FrankerFaceZ emotes'
              : 'A little expression'}
        </strong>
        <button type="button" onClick={close} aria-label="Close media picker">
          ×
        </button>
      </div>
      {tab === 'emoji' && (
        <div className="comment-emoji-grid">
          {emoji.map((value) => (
            <button
              type="button"
              key={value}
              aria-label={`Insert ${value}`}
              onClick={() => onInsert(value)}
            >
              {value}
            </button>
          ))}
        </div>
      )}
      {tab === 'emotes' && (
        <>
          <input
            aria-label="Search FrankerFaceZ emotes"
            placeholder="Find an emote…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {loading ? (
            <p role="status">Loading emotes…</p>
          ) : error ? (
            <p role="status">
              {error}{' '}
              <button type="button" onClick={() => setRetry(retry + 1)}>
                Retry emotes
              </button>
            </p>
          ) : (
            <div className="comment-emote-grid">
              {emotes
                .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
                .map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    title={item.name}
                    aria-label={`Insert ${item.name}`}
                    onClick={() => onInsert(`:${item.name}:`, item)}
                  >
                    <img
                      src={`https://cdn.frankerfacez.com/emote/${item.id}/2`}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <span>{item.name}</span>
                  </button>
                ))}
            </div>
          )}
          {!loading &&
            !error &&
            !emotes.some((item) => item.name.toLowerCase().includes(search.toLowerCase())) && (
              <p>No matching emotes.</p>
            )}
          <small>
            Global emotes from{' '}
            <a href="https://www.frankerfacez.com/" target="_blank" rel="noreferrer">
              FrankerFaceZ
            </a>
            . No extension needed.
          </small>
        </>
      )}
      {tab === 'gif' && (
        <>
          <p>Paste a direct .gif or .webp image link from GIPHY or Tenor.</p>
          <input
            aria-label="GIF image URL"
            type="url"
            placeholder="https://media.giphy.com/…/giphy.gif"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          {url && !validGif && (
            <p role="status">Use the image link, rather than the GIF’s webpage link.</p>
          )}
          {validGif && (
            <MediaImage key={validGif} src={validGif} alt="GIF preview" className="comment-gif" />
          )}
          <button
            className="comment-attach"
            type="button"
            disabled={!validGif}
            onClick={() => {
              onGif(validGif);
              close();
            }}
          >
            Attach GIF
          </button>
        </>
      )}
    </div>
  );
}
