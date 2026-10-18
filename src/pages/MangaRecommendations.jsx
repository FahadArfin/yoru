import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { kindOf, titleOf } from '../api';
import { useResource } from '../state';
import {
  recommendationGenre,
  recommendationQuery,
  relatedTitles,
  sharedRecommendationGenres,
} from '../recommendations';
import CoverImage from '../CoverImage';
import PrefetchLink from '../PrefetchLink';

export default function MangaRecommendations({ media }) {
  const related = useResource(recommendationQuery(media));
  const items = relatedTitles(media, related.data?.items);
  const resource = related;
  const loading = related.loading;
  const browse = new URLSearchParams({ sort: 'popular' });
  const genre = recommendationGenre(media);
  if (genre) browse.set('genre', genre);
  return (
    <section className="manga-fact manga-recommendations" aria-labelledby="recommendations-heading">
      <h3 id="recommendations-heading">Recommendations</h3>
      {loading ? (
        <p className="manga-recommendation-status" role="status">
          Finding similar stories…
        </p>
      ) : items.length ? (
        <div className="manga-recommendation-grid">
          {items.slice(0, 4).map((item) => (
            <PrefetchLink
              key={item.id}
              media={item}
              className="manga-recommendation-card"
              to={`/title/${encodeURIComponent(item.id)}`}
              title={titleOf(item)}
              aria-label={titleOf(item)}
            >
              <CoverImage media={item} alt="" loading="eager" fetchPriority="low" />
              <span>
                <strong>{titleOf(item)}</strong>
                <small>{sharedRecommendationGenres(media, item).slice(0, 2).join(' · ')}</small>
              </span>
            </PrefetchLink>
          ))}
        </div>
      ) : (
        <p className="manga-recommendation-status" role="status">
          {resource.error ? 'Recommendations are unavailable right now.' : 'No close matches yet.'}
        </p>
      )}
      {!loading && resource.error && !items.length && (
        <button className="manga-recommendation-more" onClick={resource.refresh}>
          Try again
        </button>
      )}
      {!loading && !resource.error && (
        <Link
          className="manga-recommendation-more"
          to={`/browse/${kindOf(media).toLowerCase()}?${browse}`}
        >
          {items.length ? 'See more' : `Browse ${kindOf(media).toLowerCase()}`}
          <ArrowRight size={19} />
        </Link>
      )}
    </section>
  );
}
