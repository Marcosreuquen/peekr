// lib/breakpoint-manager.mjs

let bpCounter = 0;
const pending = new Map(); // id -> { resolve, timer, context }

/**
 * Pauses execution until the breakpoint is resolved from outside (UI) or times out.
 *
 * @param {object} context - { host, method, path, headers, body, statusCode, direction, phase, timeoutMs }
 * @returns {Promise<{ action: string, edits?: object }>}
 */
export function pauseAtBreakpoint(context) {
  const id = `bp_${++bpCounter}`;
  const timeoutMs = context.timeoutMs ?? 30000;

  return new Promise(resolve => {
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({ action: 'continue' });
        }
      }, timeoutMs);
    }

    pending.set(id, { resolve, timer, context: { ...context, id, timeoutMs } });

    // Notify any registered listeners
    for (const fn of _listeners) {
      try { fn({ ...context, id, timeoutMs }); } catch {}
    }
  });
}

/**
 * Resolve a pending breakpoint by id.
 *
 * @param {string} id
 * @param {{ action: string, edits?: object }} resolution
 * @returns {boolean} true if found and resolved
 */
export function resolveBreakpoint(id, resolution) {
  const bp = pending.get(id);
  if (!bp) return false;
  clearTimeout(bp.timer);
  pending.delete(id);
  bp.resolve(resolution);
  return true;
}

/**
 * Returns all currently pending breakpoints (for UI reconnect/initial load).
 * @returns {object[]}
 */
export function getPendingBreakpoints() {
  return [...pending.values()].map(bp => bp.context);
}

// Internal listener registry — used by ui-server to push SSE events
const _listeners = new Set();
export function onBreakpoint(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
