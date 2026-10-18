export function rememberRoomInvite(userId, roomId, url) {
  if (!userId || !roomId || !url) return;
  try {
    sessionStorage.setItem(`yoru:invite:${userId}:${roomId}`, url);
  } catch {}
}
export function roomInvite(userId, room) {
  if (room.visibility !== 'private') return `/rooms/${room.id}`;
  try {
    return sessionStorage.getItem(`yoru:invite:${userId}:${room.id}`) || null;
  } catch {
    return null;
  }
}
