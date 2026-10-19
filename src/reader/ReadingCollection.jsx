import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from '../collection-router';
import { ArrowRight, BookOpen, Play, Plus } from 'lucide-react';
import { Button, ErrorNotice, Loading } from '../components';
import { useApp } from '../state';
import { isAnime, kindOf, titleOf } from '../api';
import { useChapters, useReadingState } from './hooks';
import { readerLink } from './model';
import {
  READER_EVENT,
  readingHistory,
  saveReadingState,
  hasStoredNativeReadingHistory,
} from './storage';
import ChapterList from './ChapterList';
import ReaderImport from './ReaderImport';
import LiveChapters from './LiveChapters';
import './reader.css';
import { visibleAccountHistory } from '../../shared/reading-account-view.js';
import { CATALOG_PREFERENCES_EVENT } from './catalog-preferences';
import CoverImage from '../CoverImage';

export function ChapterCollection({ media }) {
  const data = useChapters(media.id);
  const state = useReadingState(media.id);
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const select = (chapter, page) => navigate(readerLink(media.id, chapter, page));
  return (
    <section className="reading-collection">
      <LiveChapters key={media.id} media={media} />
      <div className="saved-chapter-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">YOUR OWN EDITIONS</span>
            <h3>Saved on this device</h3>
          </div>
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <Plus size={16} />
            Add chapters
          </Button>
        </div>
        {data.loading ? (
          <Loading />
        ) : data.items.length ? (
          <ChapterList
            chapters={data.items}
            states={state.chapters}
            onSelect={select}
            onRead={(chapter, value) => {
              try {
                saveReadingState(media.id, {}, chapter.id, { read: value });
              } catch (error) {
                setError(error.message);
              }
            }}
          />
        ) : (
          <p className="muted">Add your chapter files to read in Yoru and keep your place.</p>
        )}
        {(data.error || error) && (
          <ErrorNotice message={data.error || error} retry={data.refresh} />
        )}
        <Link className="text-link" to={`/read/${media.id}/1`}>
          Open reader & provider links
          <ArrowRight size={15} />
        </Link>
      </div>
      {importing && (
        <ReaderImport
          media={media}
          close={() => setImporting(false)}
          onImport={(chapters) => data.setItems(chapters)}
        />
      )}
    </section>
  );
}
export function PickUpWhereLeftOff() {
  const {
    library,
    user,
    resumeItems,
    resumePage,
    resumeHasStoredNativeHistory,
    loadMoreResume,
    readerInventoryPage,
    loadMoreReaderSources,
    readingContext,
    currentReaderSources,
  } = useApp();
  const [storedItems, setItems] = useState([]);
  const [hasLocalNativeHistory, setHasLocalNativeHistory] = useState(false);
  const items = visibleAccountHistory(storedItems, readingContext, {
    currentSources: currentReaderSources,
    limit: 24,
  });
  useEffect(() => {
    const update = () => {
      setHasLocalNativeHistory(hasStoredNativeReadingHistory());
      setItems([
        ...readingHistory('MANGA', readingContext, { currentSources: currentReaderSources }),
        ...readingHistory('MANHWA', readingContext, { currentSources: currentReaderSources }),
      ]);
    };
    update();
    window.addEventListener(READER_EVENT, update);
    window.addEventListener('storage', update);
    window.addEventListener(CATALOG_PREFERENCES_EVENT, update);
    return () => {
      window.removeEventListener(READER_EVENT, update);
      window.removeEventListener('storage', update);
      window.removeEventListener(CATALOG_PREFERENCES_EVENT, update);
    };
  }, [readingContext, currentReaderSources]);
  const local = (user ? [] : items).map((item) => ({
    ...item,
    page: item.chapters[item.lastChapter].page,
    href: readerLink(
      item.mediaId,
      { id: item.lastChapter, number: item.number },
      item.chapters[item.lastChapter].page,
    ),
  }));
  const saved = library
    .filter((entry) => {
      if (!entry.media || !(entry.progress > 0)) return false;
      const anime = isAnime(entry.media);
      return (
        (anime || ['MANGA', 'MANHWA'].includes(kindOf(entry.media))) &&
        (anime ? ['watching', 'current'] : ['reading', 'current']).includes(entry.status) &&
        !(user ? [] : items).some((item) => item.mediaId === entry.mediaId)
      );
    })
    .map((entry) => ({
      mediaId: entry.mediaId,
      title: titleOf(entry.media),
      cover: entry.media.cover,
      mediaSnapshot: entry.media,
      category: kindOf(entry.media),
      number: entry.progress,
      updatedAt: entry.updatedAt,
      href: isAnime(entry.media)
        ? `/watch/${entry.mediaId}/${Math.max(1, entry.progress)}`
        : `/read/${entry.mediaId}/${entry.progress}`,
    }));
  const updatedAt = (item) => Number(item.updatedAt) || Date.parse(item.updatedAt) || 0;
  const synced = resumeItems.map((item) => ({
    ...item,
    href:
      item.category === 'ANIME'
        ? `/watch/${item.mediaId}/${Math.max(1, item.number)}${item.language ? `?language=${encodeURIComponent(item.language)}` : ''}`
        : readerLink(
            item.mediaId,
            {
              id: item.chapterId,
              number: String(item.number),
              kind: 'remote',
              language: item.language,
            },
            item.page,
          ),
  }));
  const progress = [
    ...synced,
    ...local.filter((item) => !synced.some((x) => x.mediaId === item.mediaId)),
    ...saved.filter((item) => !synced.some((x) => x.mediaId === item.mediaId)),
  ]
    .sort((a, b) => updatedAt(b) - updatedAt(a))
    .slice(0, resumePage.pages > 1 ? Math.max(12, resumeItems.length) : 12);
  const inventoryIncomplete =
    !user &&
    (resumeHasStoredNativeHistory || hasLocalNativeHistory) &&
    (readerInventoryPage.incomplete || readerInventoryPage.loading);
  if (!progress.length && !resumePage.incomplete && !resumePage.loading && !inventoryIncomplete)
    return null;
  return (
    <section className="continue-reading" aria-label="Pick up where you left off">
      <div className="section-heading">
        <div>
          <span className="eyebrow">RIGHT WHERE YOU LEFT OFF</span>
          <h2>Pick up where you left off</h2>
        </div>
      </div>
      {inventoryIncomplete && (
        <div role="status">
          <p>
            {readerInventoryPage.error
              ? 'Installed sources could not be verified.'
              : 'Some installed sources have not been checked yet.'}
          </p>
          <button
            className="button secondary"
            disabled={readerInventoryPage.loading}
            onClick={loadMoreReaderSources}
          >
            {readerInventoryPage.error ? 'Retry installed sources' : 'Load more installed sources'}
          </button>
        </div>
      )}
      {(resumePage.incomplete || resumePage.loading) && (
        <div role="status">
          <p>
            {resumePage.error
              ? 'Reading history could not be verified.'
              : 'Some reading history has not been checked yet.'}
          </p>
          <button
            className="button secondary"
            disabled={resumePage.loading}
            onClick={loadMoreResume}
          >
            {resumePage.error ? 'Retry reading history' : 'Load more reading history'}
          </button>
        </div>
      )}
      <div className="continue-reading-rail">
        {progress.map((item) => {
          const anime = item.category === 'ANIME';
          return (
            <Link key={item.mediaId} to={item.href} className="continue-reading-card">
              <CoverImage
                media={item.mediaSnapshot || { ...item, id: item.mediaId }}
                alt=""
                loading="lazy"
              />
              <div>
                <strong>{item.title}</strong>
                <span>
                  {anime ? 'Anime' : item.category === 'MANHWA' ? 'Manhwa' : 'Manga'} ·{' '}
                  {anime ? 'Episode' : 'Chapter'} {item.number}
                  {!anime && item.page ? ` · Page ${item.page}` : ''}
                </span>
                <small>
                  {anime ? <Play size={12} /> : <BookOpen size={12} />}
                  {anime ? 'Continue watching' : 'Continue reading'}
                  <ArrowRight size={12} />
                </small>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
