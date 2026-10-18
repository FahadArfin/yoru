import React from 'react';
import { Link, Navigate, useParams, useSearchParams } from '../collection-router';
import { useResource } from '../state';
import { ErrorNotice, Loading } from '../components';

export default function WatchLatest() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const result = useResource(`/api/media/${id}/episodes?latest=1`);
  if (result.loading)
    return (
      <div className="page">
        <Loading />
        <p className="muted">Finding the latest released episode…</p>
      </div>
    );
  if (result.data?.latest) {
    const next = new URLSearchParams(params);
    return (
      <Navigate replace to={`/watch/${id}/${result.data.latest}${next.size ? `?${next}` : ''}`} />
    );
  }
  return (
    <div className="page">
      <h1>{result.data?.upcoming ? 'This anime hasn’t aired yet.' : 'Choose your episode.'}</h1>
      <p>
        We couldn’t confirm the latest released episode. Browse the episode guide to pick where you
        want to start.
      </p>
      {result.error && <ErrorNotice message={result.error} retry={result.refresh} />}
      {result.data?.partial && (
        <button className="btn btn-secondary" onClick={result.refresh}>
          Retry latest episode
        </button>
      )}
      <Link className="btn btn-primary" to={`/title/${id}?tab=episodes`}>
        Browse episodes
      </Link>
    </div>
  );
}
