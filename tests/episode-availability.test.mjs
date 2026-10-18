import test from 'node:test';
import assert from 'node:assert/strict';
import { episodeAvailability } from '../shared/episode-availability.js';
const now = Date.parse('2026-10-18T18:00:00Z');
const media = {
  id: 'mal-anime-60948',
  category: 'ANIME',
  status: 'Currently Airing',
  episodes: 13,
};
const metadata = { mediaId: media.id, latest: 2, partial: false, items: [] };
const recent = {
  state: 'ready',
  releases: [{ media, episode: 3, airingAt: '2026-10-18T14:00:00Z' }],
};
test('planned totals do not unlock unaired episodes and fresh releases bridge metadata lag', () => {
  assert.equal(episodeAvailability(media, 3, metadata, recent, null, now), 'released');
  assert.equal(episodeAvailability(media, 4, metadata, recent, null, now), 'unreleased');
  assert.equal(episodeAvailability(media, 13, metadata, recent, null, now), 'unreleased');
});
test('outages and missing records are unknown rather than evidence of unreleased episodes', () => {
  assert.equal(episodeAvailability(media, 4, null, null, null, now), 'unknown');
  assert.equal(
    episodeAvailability(media, 4, { ...metadata, partial: true }, null, null, now),
    'unknown',
  );
  assert.equal(
    episodeAvailability({ ...media, status: 'Finished Airing' }, 13, metadata, null, null, now),
    'released',
  );
});
test('future, delayed, mismatched and stale feed entries cannot unlock future episodes', () => {
  for (const entry of [
    { media, episode: 4, airingAt: '2026-10-25T14:00:00Z' },
    { media, episode: 4, airingAt: '2026-10-18T14:00:00Z', delayed: true },
    { media: { id: 'mal-anime-1' }, episode: 4, airingAt: '2026-10-18T14:00:00Z' },
    { media, episode: 4, airingAt: '2026-10-01T14:00:00Z' },
  ])
    assert.equal(
      episodeAvailability(media, 4, metadata, { releases: [entry] }, null, now),
      'unreleased',
    );
  assert.equal(
    episodeAvailability(media, 3, null, null, { aired: '2026-10-25' }, now),
    'unreleased',
  );
  assert.equal(
    episodeAvailability({ ...media, status: 'Not yet aired' }, 1, null, null, null, now),
    'unreleased',
  );
});
