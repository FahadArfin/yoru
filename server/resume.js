import { apiError, numeric, text } from './validation.js';

export const resumeSchema = `CREATE TABLE IF NOT EXISTS resume_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, media_id)
);`;
export const resumeUpsert = `INSERT INTO resume_progress(user_id,media_id,payload,updated_at)
  VALUES(?,?,?,?) ON CONFLICT(user_id,media_id) DO UPDATE SET
  payload=excluded.payload,updated_at=excluded.updated_at
  WHERE excluded.updated_at>resume_progress.updated_at`;
export function resumeInput(input, media, userId) {
  // This is a session-change guard, never an account selector.
  if (input?.owner !== userId)
    throw apiError(409, 'Your account changed. Reload to save progress.');
  if (!media) throw apiError(404, 'This title could not be found.');
  const anime = media.category === 'ANIME';
  return {
    mediaId: media.id,
    title: media.title,
    cover: media.cover || '',
    category: media.category,
    number: numeric(input.number, { name: 'Episode or chapter', min: 0, integer: anime }),
    chapterId: anime ? '' : text(input.chapterId || '', { name: 'Chapter edition', max: 500 }),
    page: anime
      ? null
      : numeric(input.page || 1, { name: 'Page', min: 1, max: 10000, integer: true }),
    position: anime ? numeric(input.position || 0, { name: 'Playback position', max: 604800 }) : 0,
    language: text(input.language || '', { name: 'Language', max: 20 }),
    updatedAt: numeric(input.updatedAt, {
      name: 'Progress time',
      min: 1,
      max: Date.now() + 60000,
      integer: true,
    }),
  };
}
