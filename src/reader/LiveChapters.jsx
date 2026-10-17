import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDownUp,
  BookOpen,
  ChevronDown,
  ExternalLink,
  Eye,
  Languages,
  Search,
  Star,
  Users,
} from 'lucide-react';
import { api, send } from '../api';
import { useApp } from '../state';
import { Button, ErrorNotice, Loading, Modal } from '../components';
import { recordChapterView } from '../watch-views';
import ChapterDirectory, { languageLabel } from './ChapterDirectory';

const chapterLabel = (item) => (item.number ? `Chapter ${item.number}` : 'Special chapter');

export default function LiveChapters({ media }) {
  const { user, setAuthOpen, notify } = useApp();
  const [language, setLanguage] = useState('all');
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('desc');
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [groups, setGroups] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(null);
  const [stars, setStars] = useState(0);
  const [saving, setSaving] = useState(false);
  const [ratingError, setRatingError] = useState('');
  const generation = useRef(0);
  const controller = useRef(null);
  const path = `/api/media/${media.id}/chapters`;
  function request(offset, signal) {
    return api(
      `${path}?${new URLSearchParams({ language, group, q: query, sort, offset: String(offset) })}`,
      { signal },
    );
  }
  function remember(result) {
    setLanguages(result.languages || []);
    setGroups((old) =>
      [
        ...new Map(
          [...old, ...result.items.flatMap((item) => item.groups)].map((item) => [item.id, item]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }
  useEffect(() => {
    const token = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setMore(false);
    setError('');
    setData(null);
    request(0, abort.signal)
      .then((result) => {
        if (generation.current !== token) return;
        setData(result);
        remember(result);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      generation.current++;
    };
  }, [media.id, language, group, query, sort, revision, user?.id]);
  useEffect(() => {
    setRating(null);
    setRatingError('');
  }, [user?.id]);
  async function loadMore() {
    const token = generation.current;
    setMore(true);
    setError('');
    try {
      const result = await request(data.nextOffset, controller.current.signal);
      if (generation.current !== token) return;
      setData((old) => ({
        ...result,
        items: [
          ...new Map([...old.items, ...result.items].map((item) => [item.id, item])).values(),
        ],
      }));
      remember(result);
    } catch (e) {
      if (generation.current === token) setError(e.message);
    } finally {
      if (generation.current === token) setMore(false);
    }
  }
  function updateStats(id, stats) {
    setData(
      (old) =>
        old && {
          ...old,
          items: old.items.map((item) => (item.id === id ? { ...item, stats } : item)),
        },
    );
  }
  function opened(item) {
    const token = generation.current;
    recordChapterView(media.id, item.id)
      .then((stats) => {
        if (generation.current === token) updateStats(item.id, stats);
      })
      .catch(() => {});
  }
  function rate(item) {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    setStars(item.stats?.myRating || 0);
    setRatingError('');
    setRating(item);
  }
  async function saveRating() {
    setSaving(true);
    setRatingError('');
    const token = generation.current;
    try {
      const stats = await send(`${path}/${rating.id}/rating`, { rating: stars });
      if (generation.current !== token) return;
      updateStats(rating.id, stats);
      setRating(null);
      notify('Your chapter rating is saved.');
    } catch (e) {
      if (generation.current === token) setRatingError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="live-chapters" aria-label="Live chapter catalog">
      <header className="live-chapter-heading">
        <div>
          <span className="eyebrow">KEEP THE STORY GOING</span>
          <h2>
            Chapters <span className="chapter-live-badge">Live catalog</span>
          </h2>
        </div>
        <a
          className="chapter-source"
          href={
            data?.mangaId ? `https://mangadex.org/title/${data.mangaId}` : 'https://mangadex.org/'
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          MangaDex <ExternalLink size={13} />
        </a>
      </header>
      <div className="live-chapter-controls">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search.trim());
          }}
          className="live-chapter-search"
        >
          <Search size={16} />
          <input
            aria-label="Search live chapters"
            placeholder="Chapter number or title…"
            value={search}
            maxLength={120}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit">Search</button>
        </form>
        <label>
          <Languages size={15} />
          <select
            aria-label="Translation language"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              setGroup('all');
            }}
          >
            <option value="all">All translations</option>
            {languages.map((code) => (
              <option value={code} key={code}>
                {languageLabel(code)}
              </option>
            ))}
          </select>
        </label>
        <label title="Groups found in the editions loaded so far">
          <Users size={15} />
          <select
            aria-label="Release group"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="all">All release groups</option>
            {groups.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="chapter-order"
          onClick={() => setSort(sort === 'desc' ? 'asc' : 'desc')}
          aria-label={sort === 'desc' ? 'Show oldest chapters first' : 'Show newest chapters first'}
        >
          <ArrowDownUp size={15} />
          {sort === 'desc' ? 'Newest' : 'Oldest'}
        </button>
      </div>
      {(query || language !== 'all' || group !== 'all') && (
        <button
          className="text-link chapter-clear"
          onClick={() => {
            setSearch('');
            setQuery('');
            setLanguage('all');
            setGroup('all');
          }}
        >
          Clear filters
        </button>
      )}
      {loading ? (
        <Loading label="Finding chapter editions…" />
      ) : (
        <>
          {data?.state === 'unmatched' ? (
            <div className="chapter-catalog-empty">
              <BookOpen size={28} />
              <h3>No matching chapter catalog yet</h3>
              <p>
                We couldn’t verify a MangaDex match for this title. Your saved chapters and provider
                links are still available below.
              </p>
            </div>
          ) : (
            data && (
              <>
                <div className="chapter-catalog-caption">
                  <span>
                    {data.items.length.toLocaleString()} of {data.total.toLocaleString()} editions
                  </span>
                  <span title="Opens and ratings belong to each translation edition on Yoru. They are not MangaDex statistics.">
                    Activity on Yoru <Eye size={12} />
                    <Star size={12} />
                  </span>
                </div>
                {data.stale && (
                  <p className="chapter-saved-note" role="status">
                    MangaDex is temporarily unavailable. Showing the last saved chapter list.
                  </p>
                )}
                {data.items.length ? (
                  <ChapterDirectory items={data.items} sort={sort} opened={opened} rate={rate} />
                ) : (
                  <div className="chapter-catalog-empty">
                    <BookOpen size={28} />
                    <h3>
                      {query || language !== 'all' || group !== 'all'
                        ? 'No chapters match these filters'
                        : 'No published chapters listed yet'}
                    </h3>
                    <p>Try another translation or check back for new releases.</p>
                  </div>
                )}
                {data.nextOffset !== null && (
                  <div className="chapter-load-more">
                    <Button variant="secondary" busy={more} onClick={loadMore}>
                      Load more editions <ChevronDown size={15} />
                    </Button>
                    <small>More chapters and release groups are available.</small>
                  </div>
                )}
                {data.capped && (
                  <p className="chapter-saved-note">
                    MangaDex allows the first 10,000 results per search. Choose a translation,
                    release group or chapter number to narrow this list.
                  </p>
                )}
              </>
            )
          )}
        </>
      )}
      {error && (
        <ErrorNotice
          message={error}
          retry={data?.nextOffset != null ? loadMore : () => setRevision((v) => v + 1)}
        />
      )}
      {rating && (
        <Modal
          title="Rate this chapter"
          close={() => {
            if (!saving) setRating(null);
          }}
        >
          <div className="chapter-rating-dialog">
            <span className="eyebrow">YOUR TAKE</span>
            <h3>{chapterLabel(rating)}</h3>
            <p>{rating.title || 'Untitled chapter'}</p>
            <small>
              {languageLabel(rating.language)} ·{' '}
              {rating.groups.map((g) => g.name).join(', ') || 'No group credited'}
            </small>
            <div className="chapter-stars" role="group" aria-label="Chapter rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`}
                  aria-pressed={stars === value}
                  disabled={saving}
                  onClick={() => setStars(value)}
                >
                  <Star size={30} fill={stars >= value ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
            <p>{stars ? `${stars} / 5 stars` : 'Choose your rating'}</p>
            <Button disabled={!stars} busy={saving} onClick={saveRating}>
              Save rating
            </Button>
            {ratingError && (
              <p className="form-error" role="alert">
                {ratingError}
              </p>
            )}
            <small>One rating per account for this translation. You can change it anytime.</small>
          </div>
        </Modal>
      )}
    </section>
  );
}
