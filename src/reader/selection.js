import {
  selectionProjection,
  validDestination,
  validIntegrationMode,
} from '../../shared/catalog-selection.js';

/** One identity/destination generation owns the currently usable cookie context. */
export function createReaderSelection({
  loadSettings,
  saveMode,
  syncGuest,
  readContext,
  now = Date.now,
}) {
  let snapshot = { context: null, ready: false, error: '', pendingTransition: null };
  let input = { scope: null, destination: 'yoru', enabled: false };
  let generation = 0;
  let controller;
  let leaseTimer;
  let expiredSnapshot;
  const listeners = new Set();
  const resyncRequired = new Set();
  const expired = (context) =>
    context?.scope === 'guest' && Number.isFinite(context.expiresAt) && context.expiresAt <= now();
  const displayContext = () => snapshot.context || snapshot.pendingTransition?.previousContext;
  const getSnapshot = () => (expired(displayContext()) ? expiredSnapshot : snapshot);
  const emit = (value) => {
    clearTimeout(leaseTimer);
    snapshot = { pendingTransition: null, ...value };
    expiredSnapshot = {
      context: null,
      ready: false,
      error: 'Reader choices expired. Refresh to sync your current choices.',
      pendingTransition: null,
    };
    const displayed = displayContext();
    if (displayed?.scope === 'guest' && Number.isFinite(displayed.expiresAt)) {
      leaseTimer = setTimeout(
        () => emit(expiredSnapshot),
        Math.max(1, displayed.expiresAt - now()),
      );
      leaseTimer.unref?.();
    }
    for (const listener of listeners) listener();
  };
  async function select(next = input, force = false, action) {
    const unchangedOwner =
      input.scope === next.scope &&
      input.destination === next.destination &&
      input.enabled === next.enabled;
    input = next;
    const id = ++generation;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const { scope, destination, enabled } = next;
    const previous = unchangedOwner && getSnapshot().ready ? getSnapshot().context : null;
    if (!previous) emit({ context: null, ready: false, error: '' });
    if (!enabled || !validDestination(destination)) return;
    try {
      // Unknown identity receives defaults, never another account's saved settings.
      const settings = scope === null ? selectionProjection({}) : await loadSettings(scope, force);
      if (id !== generation) return;
      const projection = selectionProjection(settings);
      if (
        previous &&
        JSON.stringify(selectionProjection(previous)) !== JSON.stringify(projection)
      ) {
        const renderOnly =
          scope !== null &&
          action?.kind === 'integration' &&
          validDestination(action.destination) &&
          validIntegrationMode(action.requestedMode) &&
          projection.modes[action.destination] === action.requestedMode &&
          JSON.stringify(selectionProjection(previous).overrides) ===
            JSON.stringify(projection.overrides);
        emit({
          context: null,
          ready: false,
          error: '',
          // This can retain permitted pixels only. It never supplies request,
          // cache, preload or personal-history authority during synchronization.
          pendingTransition: renderOnly
            ? {
                kind: 'integration',
                previousContext: previous,
                requestedMode: projection.modes[destination],
              }
            : null,
        });
      }
      if (scope === 'guest' && resyncRequired.has(destination)) {
        // Revalidation may inspect the latest cookie, but cannot reassert an
        // unchanged local projection after an uncertain or conflicting mutation.
        await readContext(destination, signal, scope);
        throw Object.assign(
          new Error('Reader choices changed. Make a new choice or reset to sync them.'),
          { concurrentChange: true },
        );
      }
      const remote =
        scope === 'guest'
          ? await syncGuest(destination, projection, signal)
          : await readContext(destination, signal, scope);
      if (id !== generation || signal.aborted) return;
      if (scope !== null && scope !== 'guest' && settings.revision !== remote.revision)
        throw new Error(
          'Reader choices changed in another tab. Refresh to use your current choices.',
        );
      if (remote.destination !== destination || !remote.selectionFingerprint)
        throw new Error('The reader returned an incompatible selection. Refresh and try again.');
      if (scope === 'guest' && Number.isFinite(remote.expiresAt) && remote.expiresAt <= now())
        throw new Error('Reader choices expired. Refresh to sync your current choices.');
      if (
        snapshot.ready &&
        previous?.selectionFingerprint === remote.selectionFingerprint &&
        previous.revision === remote.revision &&
        previous.expiresAt === remote.expiresAt
      )
        return;
      emit({
        context: {
          ...remote,
          ...projection,
          destination,
          integrationMode: projection.modes[destination],
          owner: scope,
          scope,
        },
        ready: true,
        error: '',
      });
    } catch (error) {
      if (scope === 'guest' && error.concurrentChange) resyncRequired.add(destination);
      if (id === generation && !signal.aborted) {
        emit({
          context: null,
          ready: false,
          error: error.message || 'Reader choices could not sync.',
        });
      }
    }
  }
  const preferencesChanged = (destination, action) => {
    if (input.scope === 'guest') {
      if (destination === null) resyncRequired.clear();
      else resyncRequired.delete(destination);
    }
    return select(input, true, action ? { ...action, destination } : undefined);
  };
  return {
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select,
    refresh: () => select(input, true),
    preferencesChanged,
    async setIntegrationMode(mode, destination = input.destination) {
      if (!validIntegrationMode(mode) || !validDestination(destination))
        throw new Error('Invalid integration mode.');
      const captured = input;
      if (captured.scope === null) {
        emit({
          ...snapshot,
          error: 'Wait for your account to load before changing reader choices.',
        });
        return;
      }
      try {
        const beforeSave = generation;
        await saveMode(captured.scope, destination, mode);
        // The real preference publisher starts this same action synchronously.
        // Pure/custom setters without that event still get exactly one sync.
        if (input === captured && generation === beforeSave)
          await preferencesChanged(destination, { kind: 'integration', requestedMode: mode });
      } catch (error) {
        if (input === captured)
          emit({ ...snapshot, pendingTransition: null, error: error.message });
      }
    },
    dispose() {
      generation++;
      controller?.abort();
      clearTimeout(leaseTimer);
    },
  };
}
