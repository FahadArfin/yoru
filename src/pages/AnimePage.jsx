import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Browse from './Browse';
import HomeLead from './HomeLead';
import MangaDiscovery, { useMangaFeed } from './MangaDiscovery';
import '../manga.css';

function AnimeLanding() {
  const popular = useMangaFeed('popular', 'all', 'anime');
  return (
    <div className="home-page cinema-home manga-home compact-category-page">
      <HomeLead heroOnly />
      <div className="home-content-layout home-width home-discovery-layout">
        <MangaDiscovery popular={popular} category="anime" label="Anime" />
      </div>
      <div className="manga-catalog-wrap home-width">
        <Browse embedded categoryOverride="anime" />
      </div>
    </div>
  );
}

export default function AnimePage() {
  const [params] = useSearchParams();
  const filtered = ['q', 'genre', 'format', 'sort', 'page', 'view'].some((key) => params.get(key));
  return filtered ? (
    <>
      <div className="manga-return">
        <Link to="/browse/anime">← Anime discovery</Link>
      </div>
      <Browse categoryOverride="anime" />
    </>
  ) : (
    <AnimeLanding />
  );
}
