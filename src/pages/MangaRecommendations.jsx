import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { coverOf, kindOf, titleOf } from '../api';
import { useResource } from '../state';
import { recommendationQuery, relatedTitles } from '../recommendations';

export default function MangaRecommendations({ media }) {
  const related = useResource(recommendationQuery(media));
  const matches = relatedTitles(media, related.data?.items);
  const usePopular = Boolean(media.genres?.length && !related.loading && !matches.length);
  const popular = useResource(usePopular ? recommendationQuery(media, false) : null);
  const resource = usePopular ? popular : related;
  const items = usePopular ? relatedTitles(media, popular.data?.items) : matches;
  const loading = related.loading || (usePopular && !popular.data && !popular.error);
  const browse = new URLSearchParams({ sort: 'popular' });
  if (!usePopular && media.genres?.[0]) browse.set('genre', media.genres[0]);
  return (
    <section className="manga-fact manga-recommendations" aria-labelledby="recommendations-heading">
      <h3 id="recommendations-heading">Recommendations</h3>
      {loading ? (
        <p className="manga-recommendation-status" role="status">
          Finding your next read…
        </p>
      ) : items.length ? (
        <div className="manga-recommendation-grid">
          {items.slice(0, 4).map((item) => (
            <Link
              key={item.id}
              className="manga-recommendation-card"
              to={`/title/${encodeURIComponent(item.id)}`}
              title={titleOf(item)}
            >
              <img src={coverOf(item)} alt="" loading="lazy" decoding="async" />
              <span>
                <strong>{titleOf(item)}</strong>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="manga-recommendation-status" role="status">
          {resource.error
            ? 'Recommendations are unavailable right now.'
            : 'No recommendations yet.'}
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
