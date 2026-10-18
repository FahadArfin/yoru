import React from 'react';
import { Link, useParams } from '../collection-router';
import { ArrowLeft, BookOpen, Play } from 'lucide-react';
import { isAnime, titleOf } from '../api';
import { useResource } from '../state';
import { ErrorNotice, Loading } from '../components';
import Discussion from '../Discussion';
import CoverImage from '../CoverImage';
import '../section-pages.css';
import '../community-threads.css';

export default function CommunityThread() {
  const { id, unit: rawUnit } = useParams();
  const unit = Number(rawUnit);
  const valid =
    /^mal-(anime|manga)-[1-9]\d*$/.test(id) &&
    /^\d+$/.test(rawUnit) &&
    Number.isInteger(unit) &&
    unit > 0 &&
    unit <= 100000;
  const resource = useResource(valid ? `/api/media/${id}` : null);
  const media = resource.data?.media || resource.data;
  const anime = isAnime(media);
  return (
    <div className="page section-page community-thread-page">
      <Link className="text-link" to="/community?view=releases">
        <ArrowLeft size={15} /> All discussions
      </Link>
      {!valid ? (
        <ErrorNotice message="This discussion link is not valid." />
      ) : resource.error ? (
        <ErrorNotice message={resource.error} retry={resource.refresh} />
      ) : resource.loading ? (
        <Loading />
      ) : !media ? (
        <ErrorNotice message="This title is currently unavailable." retry={resource.refresh} />
      ) : (
        <>
          <header className="thread-page-heading">
            <CoverImage media={media} alt="" />
            <div>
              <span className="section-kicker">
                {anime ? 'EPISODE' : 'CHAPTER'} {unit} · DISCUSSION
              </span>
              <h1>{titleOf(media)}</h1>
              <Link className="text-link" to={`/title/${id}`}>
                About the {anime ? 'series' : 'story'}
              </Link>
            </div>
            <Link className="btn btn-primary" to={`/${anime ? 'watch' : 'read'}/${id}/${unit}`}>
              {anime ? <Play size={16} /> : <BookOpen size={16} />}{' '}
              {anime ? 'Watch episode' : 'Read chapter'} {unit}
            </Link>
          </header>
          <Discussion key={`${id}:${unit}`} mediaId={id} unit={unit} communityLink={false} />
        </>
      )}
    </div>
  );
}
