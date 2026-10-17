const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const compare = (a, b) => {
  const x = Number(a),
    y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : natural.compare(a, b);
};

export function groupChapterEditions(items, sort = 'desc') {
  const volumes = new Map();
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const volumeKey = String(item.volume || '').trim();
    if (!volumes.has(volumeKey))
      volumes.set(volumeKey, {
        key: volumeKey,
        label: volumeKey ? `Volume ${volumeKey}` : 'No volume',
        count: 0,
        groups: new Map(),
      });
    const volume = volumes.get(volumeKey);
    const number =
      item.number == null || String(item.number).trim() === '' ? null : String(item.number);
    const key = number === null ? `special:${item.id}` : `chapter:${number}`;
    if (!volume.groups.has(key)) volume.groups.set(key, { key, number, items: [] });
    volume.groups.get(key).items.push(item);
    volume.count++;
  }
  const direction = sort === 'asc' ? 1 : -1;
  return [...volumes.values()]
    .sort((a, b) => (!a.key ? -1 : !b.key ? 1 : direction * compare(a.key, b.key)))
    .map(({ groups, ...volume }) => ({
      ...volume,
      chapters: [...groups.values()].sort((a, b) => {
        if (a.number === null) return b.number === null ? 0 : 1;
        if (b.number === null) return -1;
        return direction * compare(a.number, b.number);
      }),
    }));
}
