export const DAY_MS = 86400000;
export function localDateKey(value, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((x) => x.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
export function weekStart(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftDate(date, -((day + 6) % 7));
}
export const weekDays = (start) => Array.from({ length: 7 }, (_, i) => shiftDate(start, i));
export function isoWeek(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  return { year, week: Math.ceil(((d - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7) };
}
export function airingLabel(item, now = Date.now()) {
  if (item.delayed) return 'Delayed';
  if (!item.airingAt) return 'Time unconfirmed';
  const minutes = Math.ceil((Date.parse(item.airingAt) - now) / 60000);
  if (minutes <= 0) return 'Aired';
  if (minutes < 60) return `In ${minutes}m`;
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  if (hours < 24) return `In ${hours}h${rest ? ` ${rest}m` : ''}`;
  return `In ${Math.floor(hours / 24)}d ${hours % 24}h`;
}
