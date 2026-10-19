import { assertMediaEligible } from './reading-eligibility.js';
import { parseMediaReference } from './media-reference.js';

// A visible projection never mutates persisted history. Current inventory or a
// current authenticated server view is required before admitting native snapshots.
export function visibleAccountHistory(
  items,
  context,
  { currentSources = [], authoritativeIds, limit = 100 } = {},
) {
  if (!context) return [];
  return items
    .filter((item) => {
      const approved = authoritativeIds?.has(item.mediaId);
      if (authoritativeIds && !approved) return false;
      let media = item.mediaSnapshot || (approved ? { ...item, id: item.mediaId } : null);
      if (media?.id !== item.mediaId) return false;
      if (parseMediaReference(item.mediaId)?.kind === 'extension-manga') {
        const observed = currentSources.find((source) => source.id === media.sourceRef?.id);
        if (!approved && !observed) return false;
        if (observed) {
          if (
            !['id', 'integration', 'providerKey', 'language', 'upstreamSourceId'].every(
              (k) => observed[k] === media.sourceRef?.[k],
            )
          )
            return false;
          media = { ...media, sourceRef: observed };
        }
      }
      try {
        assertMediaEligible(media, context);
        return true;
      } catch {
        return false;
      }
    })
    .sort(
      (a, b) =>
        (Number(b.updatedAt) || Date.parse(b.updatedAt) || 0) -
        (Number(a.updatedAt) || Date.parse(a.updatedAt) || 0),
    )
    .slice(0, limit);
}
