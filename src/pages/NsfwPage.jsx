import React, { lazy, Suspense, useEffect } from 'react';
import { Link, Route, Routes, useParams, useLocation } from 'react-router-dom';
import { ArrowUpRight, LockKeyhole } from 'lucide-react';
import { confirmationKey } from '../nsfw';
import { useCollection } from '../collection-context';
import { Empty, Loading, ErrorNotice } from '../components';
import Home from './Home';
import Browse from './Browse';
import AnimePage from './AnimePage';
import MangaPage from './MangaPage';
import SpaceLayout from '../SpaceLayout';
const Title = lazy(() => import('./Title'));
const Watch = lazy(() => import('./Watch'));
const WatchLatest = lazy(() => import('./WatchLatest'));
const Reader = lazy(() => import('../reader/Reader'));
const Schedule = lazy(() => import('./Schedule'));
const Community = lazy(() => import('./Community'));
const CommunityThread = lazy(() => import('./CommunityThread'));
const ForumTopic = lazy(() => import('./ForumTopic'));
const Library = lazy(() => import('./Library'));
const Rooms = lazy(() => import('./Rooms'));
const Room = lazy(() => import('./Room'));
const Settings = lazy(() => import('./Settings'));
function ReviewedTitle({ children }) {
  const { id } = useParams();
  const scope = useCollection();
  return scope.catalog?.items?.some((item) => item.id === id) ? (
    children
  ) : (
    <Empty title="Title not in this collection">
      <Link to="/ara-ara">Explore Ara Ara</Link>
    </Empty>
  );
}
export default function NsfwPage() {
  const scope = useCollection();
  const { pathname } = useLocation();
  useEffect(() => {
    if (scope.confirmed) document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [scope.confirmed]);
  const confirm = () => {
    try {
      sessionStorage.setItem(confirmationKey, '1');
    } catch {}
    window.dispatchEvent(new CustomEvent('ara-confirmation', { detail: { confirmed: true } }));
  };
  if (!scope.confirmed)
    return (
      <section className="nsfw-page nsfw-gate" aria-labelledby="nsfw-gate-title">
        <span className="nsfw-gate-symbol" aria-hidden="true">
          <LockKeyhole size={29} />
        </span>
        <span className="nsfw-eyebrow">ARA ARA · 18+</span>
        <h1 id="nsfw-gate-title">Adults only</h1>
        <p>Welcome to Ara Ara, the separate Yoru space for visitors aged 18 or older.</p>
        <p className="nsfw-gate-detail">
          Mature themes, violence and strong language. This collection excludes sexually explicit
          titles. Please confirm your age before continuing.
        </p>
        <div className="nsfw-gate-actions">
          <button className="btn btn-primary" onClick={confirm}>
            I’m 18 or older <ArrowUpRight size={16} />
          </button>
          <Link className="btn btn-ghost" to="/">
            Back to Yoru
          </Link>
        </div>
      </section>
    );

  if (scope.loading) return <Loading cards />;
  if (scope.error) return <ErrorNotice message={scope.error} retry={scope.refresh} />;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route index element={<Home />} />
        <Route path="anime" element={<AnimePage />} />
        <Route path="manga" element={<MangaPage />} />
        <Route path="manhwa" element={<MangaPage category="manhwa" />} />
        <Route path="all" element={<Browse categoryOverride="all" />} />
        <Route
          path="title/:id"
          element={
            <ReviewedTitle>
              <Title />
            </ReviewedTitle>
          }
        />
        <Route
          path="watch/:id/latest"
          element={
            <ReviewedTitle>
              <WatchLatest />
            </ReviewedTitle>
          }
        />
        <Route
          path="watch/:id/:unit"
          element={
            <ReviewedTitle>
              <Watch />
            </ReviewedTitle>
          }
        />
        <Route
          path="read/:id/:unit"
          element={
            <ReviewedTitle>
              <Reader />
            </ReviewedTitle>
          }
        />
        <Route path="schedule" element={<Schedule />} />
        <Route
          path="community"
          element={
            <SpaceLayout>
              <Community />
            </SpaceLayout>
          }
        />
        <Route
          path="community/:id/:unit"
          element={
            <ReviewedTitle>
              <SpaceLayout>
                <CommunityThread />
              </SpaceLayout>
            </ReviewedTitle>
          }
        />
        <Route
          path="community/forum/:topicId"
          element={
            <SpaceLayout>
              <ForumTopic />
            </SpaceLayout>
          }
        />
        <Route
          path="library"
          element={
            <SpaceLayout>
              <Library />
            </SpaceLayout>
          }
        />
        <Route
          path="rooms"
          element={
            <SpaceLayout>
              <Rooms />
            </SpaceLayout>
          }
        />
        <Route path="rooms/:id" element={<Room />} />
        <Route path="settings" element={<Settings key={pathname} />} />
        <Route
          path="*"
          element={
            <Empty title="Collection not found">
              <Link to="/ara-ara">Explore Ara Ara</Link>
            </Empty>
          }
        />
      </Routes>
    </Suspense>
  );
}
