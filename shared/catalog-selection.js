const DESTINATIONS = ['yoru', 'ara-ara'];
const MODES = ['all', 'core', 'extensions'];
const FORBIDDEN = ['__proto__', 'constructor', 'prototype'];
const MAX_BYTES = 16 * 1024;

/** @returns {import('./reading-contracts.js').IntegrationMode} */
export function normalizeIntegrationMode(value) {
  return MODES.includes(value) ? value : 'all';
}

/** @returns {import('./reading-contracts.js').Destination} */
export function normalizeDestination(value) {
  return value === 'ara-ara' ? 'ara-ara' : 'yoru';
}

function invalid() {
  throw Object.assign(new Error('Invalid catalog selection.'), { status: 400, expose: true });
}
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value;
}
function bounded(value) {
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    invalid();
  }
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > MAX_BYTES) invalid();
}

/** Validate only a guest's membership/mode projection; never accept account identity.
 * @returns {import('./reading-contracts.js').CatalogSelection}
 */
export function normalizeGuestSelection(input = {}) {
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > MAX_BYTES) invalid();
    try {
      input = JSON.parse(input);
    } catch {
      invalid();
    }
  }
  record(input);
  bounded(input);
  if (Object.keys(input).some((key) => !['overrides', 'modes'].includes(key))) invalid();
  const rawOverrides = record(input.overrides === undefined ? {} : input.overrides);
  const providers = Object.keys(rawOverrides).sort();
  if (providers.length > 100) invalid();
  const overrides = {};
  for (const provider of providers) {
    if (
      !provider.trim() ||
      provider.length > 100 ||
      /[\x00-\x1f]/.test(provider) ||
      FORBIDDEN.includes(provider)
    )
      invalid();
    const memberships = record(rawOverrides[provider]);
    if (Object.keys(memberships).some((key) => !DESTINATIONS.includes(key))) invalid();
    overrides[provider] = {};
    for (const destination of DESTINATIONS) {
      if (!Object.hasOwn(memberships, destination)) continue;
      if (typeof memberships[destination] !== 'boolean') invalid();
      overrides[provider][destination] = memberships[destination];
    }
  }
  const rawModes = record(input.modes === undefined ? {} : input.modes);
  if (Object.keys(rawModes).some((key) => !DESTINATIONS.includes(key))) invalid();
  const modes = { yoru: 'all', 'ara-ara': 'all' };
  for (const destination of DESTINATIONS) {
    if (!Object.hasOwn(rawModes, destination)) continue;
    if (!MODES.includes(rawModes[destination])) invalid();
    modes[destination] = rawModes[destination];
  }
  const result = { overrides, modes };
  bounded(result);
  return result;
}

/** Project server/account selections into the same canonical guest-safe value. */
export function selectionProjection(selection = {}) {
  record(selection);
  return normalizeGuestSelection({
    overrides: selection.overrides,
    modes: selection.modes,
  });
}
