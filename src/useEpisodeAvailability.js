import { useResource } from './state';
import { episodeAvailability } from '../shared/episode-availability';

export default function useEpisodeAvailability(media, details) {
  const ongoing =
    media?.category === 'ANIME' &&
    /^(currently airing|releasing|airing)$/i.test(media.status || '');
  const latest = useResource(ongoing ? `/api/media/${media.id}/episodes?latest=1` : null);
  const recent = useResource(ongoing ? '/api/home?language=all' : null);
  return {
    loading: ongoing && (latest.loading || recent.loading),
    state: (number) =>
      episodeAvailability(
        media,
        number,
        latest.data,
        recent.data,
        details?.items?.find((item) => item.number === number),
      ),
  };
}
