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
import { invalidateApi } from '../api';
import { useApp } from '../state';
import { Button, ErrorNotice, Loading, Modal } from '../components';
import { recordChapterView } from '../watch-views';
import ChapterDirectory, { languageLabel } from './ChapterDirectory';
import { savedReadingSource, rememberReadingSource } from './remote';
import { chapterList, readingSources, readerContextKey, readerMutation } from './requests';
import { useReaderSelection } from '../useCatalogPreferences';
import CatalogIntegrationSelect from '../CatalogIntegrationSelect';

const chapterLabel = (item) =>
  item.number != null && item.number !== '' ? `Chapter ${item.number}` : 'Special chapter';

export default function LiveChapters({ media }) {
  const { user, setAuthOpen, notify } = useApp();
  const selection = useReaderSelection();
  const context = selection?.ready ? selection.context : null;
  const contextKey = readerContextKey(context);
  const [language, setLanguage] = useState(media.sourceRef?.language || 'en');
  const [source, setSource] = useState(
    media.sourceRef?.id || savedReadingSource(media.id) || 'mangadex',
  );
  const [sourceState, setSourceState] = useState({ key: '', items: [] });
  const sources = sourceState.key === contextKey ? sourceState.items : [];
  const [sourceIssue, setSourceIssue] = useState('');
  const [sourceRevision, setSourceRevision] = useState(0);
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('desc');
  const [revision, setRevision] = useState(0);
  const picked = sources.find((item) => item.id === source);
  const targetId = picked?.mediaId || media.id;
  const key = `${contextKey}:${targetId}:${source}:${language}:${group}:${query}:${sort}`;
  const [snapshot, setSnapshot] = useState({ key: '', data: null });
  const data = snapshot.key === key ? snapshot.data : null;
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
  const operation = useRef(null);
  const path = `/api/media/${targetId}/chapters`;
  const setData = (value) =>
    setSnapshot((old) => ({
      key,
      data: typeof value === 'function' ? value(old.key === key ? old.data : null) : value,
    }));
  useEffect(() => {
    const controller = new AbortController();
    setSourceIssue('');
    if (!context) return () => controller.abort();
    readingSources(media.id, sourceRevision > 0, { ...context, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        const choices = result.sources;
        setSourceState({ key: contextKey, items: choices });
        const preferred = savedReadingSource(media.id);
        setSource(
          choices.some((s) => s.id === preferred)
            ? preferred
            : choices.some((s) => s.id === media.sourceRef?.id)
              ? media.sourceRef.id
              : choices.find((s) => s.id === 'weebcentral')?.id || choices[0]?.id || '',
        );
        setSourceIssue(
          result.partial || result.state === 'offline'
            ? 'Some reading sources are temporarily unavailable.'
            : result.disabled
              ? 'No chapter sources are enabled in this integration group. Choose another group or change Reader catalogs in Settings.'
              : '',
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setSourceState({ key: contextKey, items: [] });
          setSourceIssue(error.message);
        }
      });
    return () => controller.abort();
  }, [media.id, contextKey, sourceRevision]);
  function request(offset, signal) {
    return chapterList(
      targetId,
      {
        source,
        sourceRef:
          picked?.sourceRef || (media.sourceRef?.id === source ? media.sourceRef : undefined),
        language,
        group,
        q: query,
        sort,
        ...(picked?.integration === 'suwayomi' || picked?.sourceRef?.integration === 'suwayomi'
          ? { page: offset || 1 }
          : { offset }),
      },
      { ...context, signal },
      revision > 0,
    );
  }
  function remember(result) {
    setLanguages(
      result.languages || [...new Set(result.items.map((item) => item.language).filter(Boolean))],
    );
    setGroups((old) =>
      [
        ...new Map(
          [...old, ...result.items.flatMap((item) => item.groups || [])].map((item) => [
            item.id,
            item,
          ]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }
  useEffect(() => {
    const token = ++generation.current;
    const controller = new AbortController();
    operation.current = controller;
    setLoading(!!context && !!picked);
    setMore(false);
    setError('');
    setSnapshot({ key, data: null });
    setGroups([]);
    setLanguages([]);
    if (context && picked)
      request(0, controller.signal)
        .then((result) => {
          if (generation.current === token && !controller.signal.aborted) {
            setData(result);
            remember(result);
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [key, !!picked, revision]);
  useEffect(() => {
    setRating(null);
    setRatingError('');
  }, [contextKey]);
  async function loadMore() {
    const token = generation.current;
    const controller = operation.current;
    if (!context || !controller || controller.signal.aborted) return;
    setMore(true);
    setError('');
    try {
      const result = await request(data.nextPage ?? data.nextOffset, controller.signal);
      if (generation.current !== token || controller.signal.aborted) return;
      setData((old) => ({
        ...result,
        items: [
          ...new Map(
            [...(old?.items || []), ...result.items].map((item) => [item.id, item]),
          ).values(),
        ],
      }));
      remember(result);
    } catch (error) {
      if (generation.current === token) setError(error.message);
    } finally {
      if (generation.current === token) setMore(false);
    }
  }
  function updateStats(id, stats) {
    invalidateApi(path);
    const visibleStats = context?.scope === null ? { ...stats, myRating: 0 } : stats;
    setData(
      (old) =>
        old && {
          ...old,
          items: old.items.map((item) =>
            item.id === id ? { ...item, stats: visibleStats } : item,
          ),
        },
    );
  }
  function opened(item) {
    if (!context || !operation.current) return;
    const token = generation.current;
    recordChapterView(item.mediaId || targetId, item.id, {
      ...context,
      signal: operation.current.signal,
    })
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
    if (!context || !operation.current) return;
    setSaving(true);
    setRatingError('');
    const token = generation.current;
    try {
      const stats = await readerMutation(`${path}/${rating.id}/rating`, { rating: stars }, 'POST', {
        ...context,
        signal: operation.current.signal,
      });
      if (generation.current !== token) return;
      updateStats(rating.id, stats);
      setRating(null);
      notify('Your chapter rating is saved.');
    } catch (error) {
      if (generation.current === token) setRatingError(error.message);
    } finally {
      if (generation.current === token) setSaving(false);
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
            source === 'weebcentral'
              ? 'https://weebcentral.com/'
              : source !== 'mangadex'
                ? undefined
                : data?.mangaId
                  ? `https://mangadex.org/title/${data.mangaId}`
                  : 'https://mangadex.org/'
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          {sources.find((s) => s.id === source)?.name || 'Reading source'}{' '}
          <ExternalLink size={13} />
        </a>
      </header>
      {sourceIssue && (
        <p className="chapter-saved-note" role="status">
          <span>{sourceIssue}</span>{' '}
          <button
            className="text-link"
            onClick={() => {
              setSourceRevision((n) => n + 1);
              setRevision((n) => n + 1);
            }}
          >
            Retry sources
          </button>
        </p>
      )}
      <div className="live-chapter-controls">
        <CatalogIntegrationSelect
          className="chapter-translation-filter reader-integration-filter"
          value={context?.integrationMode || 'all'}
          onChange={(mode) => selection.setIntegrationMode(mode)}
          disabled={!context}
        />
        {sources.length > 0 && (
          <label className="chapter-translation-filter">
            <BookOpen size={15} />
            <span>Source</span>
            <select
              aria-label="Chapter source"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setGroup('all');
                setGroups([]);
                rememberReadingSource(media.id, e.target.value);
              }}
            >
              {!sources.some((item) => item.id === source) && (
                <option value={source} disabled>
                  Choose an enabled source
                </option>
              )}
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.integration === 'suwayomi' ? 'Suwayomi' : 'Core'}
                  {s.sourceRef?.language ? ` · ${languageLabel(s.sourceRef.language)}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
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
        <label className="chapter-translation-filter">
          <Languages size={15} aria-hidden="true" />
          <span>Translation</span>
          <select
            aria-label="Translation language"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              setGroup('all');
            }}
          >
            <option value="en">English</option>
            <option value="all">All translations</option>
            {languages
              .filter((code) => code !== 'en')
              .map((code) => (
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
      {(query || language !== 'en' || group !== 'all') && (
        <button
          className="text-link chapter-clear"
          onClick={() => {
            setSearch('');
            setQuery('');
            setLanguage('en');
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
                    {data.items.length.toLocaleString()}
                    {Number.isFinite(data.total) ? ` of ${data.total.toLocaleString()}` : ''}{' '}
                    editions
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
                  <ChapterDirectory
                    items={data.items}
                    mediaId={targetId}
                    context={context}
                    sort={sort}
                    opened={opened}
                    rate={rate}
                  />
                ) : (
                  <div className="chapter-catalog-empty">
                    <BookOpen size={28} />
                    <h3>
                      {language === 'en' && !query && group === 'all'
                        ? 'No English chapters available'
                        : query || language !== 'all' || group !== 'all'
                          ? 'No chapters match these filters'
                          : 'No published chapters listed yet'}
                    </h3>
                    <p>Try another translation or check back for new releases.</p>
                    {language !== 'all' && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSearch('');
                          setQuery('');
                          setLanguage('all');
                          setGroup('all');
                        }}
                      >
                        Show all translations
                      </Button>
                    )}
                  </div>
                )}
                {(data.nextOffset != null || data.hasMore) && (
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
              {rating.groups?.map((g) => g.name).join(', ') || 'No group credited'}
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
