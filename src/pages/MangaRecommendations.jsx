import React from 'react';
import { Link } from '../collection-router';
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
import { useReaderFeed } from '../reader/use-feed';
import { useReaderSelection } from '../useCatalogPreferences';
import { visibleReadingItems } from '../reader/feed';

export default function MangaRecommendations({ media }) {
  const selection = useReaderSelection();
  const anime = kindOf(media) === 'ANIME';
  const native = /^ext-manga-[a-f0-9]{32}$/.test(media.id);
  const coreAllowed =
    anime || (selection?.ready && selection.context.integrationMode !== 'extensions');
  const related = useResource(coreAllowed && !native ? recommendationQuery(media) : null);
  const remote = useReaderFeed(
    !anime && recommendationGenre(media) ? '/api/reader/discovery?mode=popular&limit=48' : null,
  );
  const candidates = [
    ...(coreAllowed ? related.data?.items || [] : []),
    ...visibleReadingItems(remote.data?.items || [], {
      context: selection?.context,
      category: kindOf(media).toLowerCase(),
    }),
  ];
  const items =
    anime || selection?.ready ? relatedTitles(media, candidates, selection?.context || {}) : [];
  const resource = native || !coreAllowed ? remote : related;
  const loading = resource.loading;
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
