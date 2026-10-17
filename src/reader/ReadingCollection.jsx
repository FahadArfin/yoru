import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, Plus } from 'lucide-react';
import { Button, ErrorNotice, Loading } from '../components';
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
export function ContinueReading({ category }) {
  const [items, setItems] = useState(() => readingHistory(category.toUpperCase()));
  useEffect(() => {
    const update = () => setItems(readingHistory(category.toUpperCase()));
    update();
    window.addEventListener(READER_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(READER_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, [category]);
  if (!items.length) return null;
  return (
    <section className="continue-reading" aria-label="Continue reading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">RIGHT WHERE YOU LEFT OFF</span>
          <h2>Continue reading</h2>
        </div>
        <span className="muted">On this device</span>
      </div>
      <div className="continue-reading-rail">
        {items.map((item) => {
          const position = item.chapters[item.lastChapter];
          return (
            <Link
              key={item.mediaId}
              to={readerLink(
                item.mediaId,
                { id: item.lastChapter, number: item.number },
                position.page,
              )}
              className="continue-reading-card"
            >
              <img src={item.cover || '/icon.svg'} alt="" loading="lazy" />
              <div>
                <strong>{item.title}</strong>
                <span>
                  Chapter {item.number} · Page {position.page}
                </span>
                <small>
                  <BookOpen size={12} />
                  Continue the story
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
