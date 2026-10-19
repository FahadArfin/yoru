import { parseMediaReference } from '../shared/media-reference.js';

export function apiError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}
export function text(value, { name = 'Text', min = 0, max = 1000 } = {}) {
  if (typeof value !== 'string') throw apiError(400, `${name} must be text.`);
  const result = value.trim();
  if (
    result.length < min ||
    result.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)
  )
    throw apiError(400, `${name} must contain ${min}–${max} characters.`);
  return result;
}
export function numeric(value, { name = 'Value', min = 0, max = 100000, integer = false } = {}) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw apiError(
      400,
      `${name} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`,
    );
  return value;
}
export function mediaId(value) {
  if (!parseMediaReference(value)) throw apiError(400, 'Invalid title ID.');
  return value;
}
export function bool(value, name) {
  if (typeof value !== 'boolean') throw apiError(400, `${name} must be true or false.`);
  return value;
}
