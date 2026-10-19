// One controller belongs to one owner/destination/preferences scope. Each action
// performs one bounded server request; continuation branches never fan out.
export function createAccountPager({ request, publish }) {
  let active = true,
    generation = 0,
    controller,
    running = false;
  let items = new Map(),
    queue = [],
    seen = new Set(),
    blocked = false,
    pages = 0;
  let snapshot = { items: [], loading: false, incomplete: false, error: false, ready: false };
  const key = (task) => JSON.stringify([task.cursor || null, task.sourceCursor || null]);
  const emit = (patch) => {
    snapshot = { ...snapshot, ...patch, items: [...items.values()] };
    if (active) publish(snapshot);
  };
  const enqueue = (task) => {
    if (!seen.has(key(task)) && !queue.some((pending) => key(pending) === key(task)))
      queue.push(task);
  };
  async function load(task, reset) {
    if (!active || (running && !reset)) return;
    const ticket = ++generation;
    controller?.abort();
    controller = new AbortController();
    running = true;
    if (reset) {
      items = new Map();
      queue = [];
      seen = new Set();
      blocked = false;
      pages = 0;
    }
    // Readiness belongs to this controller's initialized scope. Revalidation
    // clears authorization above, while leaving mounted consumers initialized.
    emit({ loading: true, error: false, ...(reset ? { incomplete: false } : {}) });
    try {
      const result = await request(
        task,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      if (!active || ticket !== generation) return;
      seen.add(key(task));
      pages++;
      for (const item of result.items || []) items.set(item.mediaId, item);
      // Source continuation covers the SAME record range; a row continuation
      // starts a new range with a fresh bounded current inventory observation.
      if (result.sourceCursor) enqueue({ ...task, sourceCursor: result.sourceCursor });
      if (result.nextCursor) enqueue({ cursor: result.nextCursor });
      blocked ||=
        (result.inventoryComplete === false && !result.sourceCursor) ||
        (result.recordsComplete === false && !result.nextCursor);
      emit({
        loading: false,
        ready: true,
        error: false,
        incomplete: blocked || queue.length > 0,
        pages,
        inventoryComplete: result.inventoryComplete,
        recordsComplete: result.recordsComplete,
      });
    } catch (error) {
      if (!active || ticket !== generation) return;
      // A failed current proof must not keep old authenticated authorization.
      items = new Map();
      queue = [];
      blocked = true;
      emit({ loading: false, ready: true, error: true, incomplete: true });
    } finally {
      if (ticket === generation) running = false;
    }
  }
  return {
    refresh: () => load({}, true),
    loadMore: () =>
      running ? Promise.resolve() : queue.length ? load(queue.shift(), false) : load({}, true),
    stop() {
      active = false;
      generation++;
      controller?.abort();
    },
  };
}
export function accountPageUrl(path, destination, task) {
  const query = new URLSearchParams({ destination });
  for (const name of ['cursor', 'sourceCursor']) if (task[name]) query.set(name, task[name]);
  return `${path}?${query}`;
}
