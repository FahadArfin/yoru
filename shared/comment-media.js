// Small, portable text tokens keep existing comments and both storage backends compatible.
// Never interpret arbitrary HTML or markdown as images.
export function gifUrl(value) {
  try {
    const url = new URL(String(value).trim());
    if (/[()]/.test(url.href)) return '';
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (!/^(media\d*\.giphy\.com|i\.giphy\.com|media\d*\.tenor\.com)$/.test(url.hostname))
      return '';
    if (!/\.(gif|webp)$/i.test(url.pathname) || url.href.length > 1200) return '';
    return url.href;
  } catch {
    return '';
  }
}
export const gifToken = (url) => `![GIF](${url})`;
export const emoteToken = (emote) => `[[ffz:${emote.id}:${emote.name}]]`;
export function commentParts(body = '') {
  const pattern = /!\[GIF\]\(([^\s)]+)\)|\[\[ffz:([1-9]\d{0,9}):([A-Za-z0-9_]{1,60})\]\]/g;
  const parts = [];
  let end = 0;
  for (const match of body.matchAll(pattern)) {
    if (match.index > end) parts.push({ type: 'text', text: body.slice(end, match.index) });
    const url = match[1] && gifUrl(match[1]);
    parts.push(
      url
        ? { type: 'gif', url }
        : match[2]
          ? {
              type: 'emote',
              name: match[3],
              url: `https://cdn.frankerfacez.com/emote/${match[2]}/2`,
            }
          : { type: 'text', text: match[0] },
    );
    end = match.index + match[0].length;
  }
  if (end < body.length) parts.push({ type: 'text', text: body.slice(end) });
  return parts;
}
export function commentMediaError(body) {
  const gifs = [...body.matchAll(/!\[GIF\]\(([^\s)]+)\)/g)];
  if (gifs.some((match) => !gifUrl(match[1]))) return 'Use a direct GIF link from GIPHY or Tenor.';
  if (gifs.length > 1) return 'Attach one GIF per comment.';
  if (commentParts(body).filter((part) => part.type === 'emote').length > 30)
    return 'Use up to 30 emotes per comment.';
  return '';
}
export function commentPreview(body) {
  return commentParts(body)
    .map((part) => (part.type === 'text' ? part.text : part.type === 'gif' ? '[GIF]' : part.name))
    .join('');
}
