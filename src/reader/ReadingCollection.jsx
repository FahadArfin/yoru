import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, Play, Plus } from 'lucide-react';
import { Button, ErrorNotice, Loading } from '../components';
import { useApp } from '../state';
import { isAnime, kindOf, titleOf } from '../api';
import { useChapters, useReadingState } from './hooks';
import { readerLink } from './model';
import { READER_EVENT, readingHistory, saveReadingState } from './storage';
import ChapterList from './ChapterList';
import ReaderImport from './ReaderImport';
import LiveChapters from './LiveChapters';
import './reader.css';

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
  const { library, user, resumeItems } = useApp();
  const [items, setItems] = useState(() => [
    ...readingHistory('MANGA'),
    ...readingHistory('MANHWA'),
  ]);
  useEffect(() => {
    const update = () => setItems([...readingHistory('MANGA'), ...readingHistory('MANHWA')]);
    update();
    window.addEventListener(READER_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(READER_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
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
    .slice(0, 12);
  if (!progress.length) return null;
  return (
    <section className="continue-reading" aria-label="Pick up where you left off">
      <div className="section-heading">
        <div>
          <span className="eyebrow">RIGHT WHERE YOU LEFT OFF</span>
          <h2>Pick up where you left off</h2>
        </div>
      </div>
      <div className="continue-reading-rail">
        {progress.map((item) => {
          const anime = item.category === 'ANIME';
          return (
            <Link key={item.mediaId} to={item.href} className="continue-reading-card">
              <img src={item.cover || '/icon.svg'} alt="" loading="lazy" />
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
