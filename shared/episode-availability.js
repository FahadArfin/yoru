export function episodeAvailability(media, number, metadata, recent, detail, now = Date.now()) {
  const upcoming = /^(not yet aired|upcoming|tba)$/i.test(media?.status || '');
  const finished = /^(finished airing|finished)$/i.test(media?.status || '');
  const ongoing = /^(currently airing|releasing|airing)$/i.test(media?.status || '');
  const releases = (recent?.releases || []).filter(
    (item) =>
      item.media?.id === media?.id &&
      !item.delayed &&
      Number.isInteger(item.episode) &&
      Date.parse(item.airingAt) <= now &&
      Date.parse(item.airingAt) >= now - 7 * 86400000,
  );
  const released = Math.max(0, ...releases.map((item) => item.episode));
  const latest = Math.max(
    recent?.state === 'ready' && !recent.stale ? released : 0,
    metadata?.mediaId === media?.id && !metadata.partial ? metadata.latest || 0 : 0,
  );
  const item = detail || metadata?.items?.find((item) => item.number === number);
  // A fresh release feed can precede the episode metadata update.
  if (number <= released) return 'released';
  if (upcoming || (item?.aired && Date.parse(item.aired) > now)) return 'unreleased';
  if (finished || (item?.aired && Date.parse(item.aired) <= now)) return 'released';
  // A season's announced total is never evidence that its episodes have aired.
  // With no reliable boundary, preserve access instead of treating an outage as unreleased.
  if (ongoing && latest > 0 && number > latest) return 'unreleased';
  return number <= latest ? 'released' : 'unknown';
}
