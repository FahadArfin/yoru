// Room readers may embed only Yoru's reader for this exact title and chapter.
export function roomReaderPath(value, mediaId, unit) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.length > 2048
  )
    return null;
  let url;
  try {
    url = new URL(value, 'https://yoru.invalid');
  } catch {
    return null;
  }
  if (
    url.origin !== 'https://yoru.invalid' ||
    url.hash ||
    !url.pathname.startsWith(`/read/${mediaId}/`) ||
    !/^\d+(\.\d+)?$/.test(url.pathname.slice(`/read/${mediaId}/`.length)) ||
    Number(url.pathname.slice(`/read/${mediaId}/`.length)) !== unit ||
    !/^mal-manga-\d+$/.test(mediaId)
  )
    return null;
  for (const [key, val] of url.searchParams) {
    if (key === 'source' && ['mangadex', 'weebcentral', 'local'].includes(val)) continue;
    if (key === 'language' && /^(all|[a-z]{2}(?:-[a-z]{2,4})?)$/.test(val)) continue;
    if (key === 'chapter' && val.length > 0 && val.length <= 512) continue;
    if (key === 'page' && /^\d+$/.test(val) && Number(val) >= 1 && Number(val) <= 5000) continue;
    return null;
  }
  return `/read/${mediaId}/${unit}` + url.search;
}

export function readerAtUnit(value, mediaId, unit) {
  try {
    const url = new URL(value, 'https://yoru.invalid');
    url.pathname = `/read/${mediaId}/${unit}`;
    url.searchParams.delete('chapter');
    url.searchParams.delete('page');
    return roomReaderPath(url.pathname + url.search, mediaId, unit);
  } catch {
    return null;
  }
}
