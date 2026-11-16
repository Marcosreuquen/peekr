// lib/breakpoint-manager.mjs

let bpCounter = 0;
const pending = new Map(); // id -> { resolve, timer, context }
let interceptEnabled = false;

export function getInterceptEnabled() { return interceptEnabled; }

export function setInterceptEnabled(enabled) {
  interceptEnabled = enabled;
  const released = [];
  if (!enabled) {
    for (const [id, bp] of pending) {
      if (bp.context.source === 'intercept') {
        resolveBreakpoint(id, { action: 'continue' });
        released.push(id);
      }
    }
  }
  return released;
}

/**
 * Pauses execution until the breakpoint is resolved from outside (UI) or times out.
 *
 * @param {object} context - { host, method, path, headers, body, statusCode, direction, phase, timeoutMs }
 * @returns {Promise<{ action: string, edits?: object }>}
 */
export function pauseAtBreakpoint(context) {
  const id = `bp_${++bpCounter}`;
  const timeoutMs = context.timeoutMs ?? 30000;
  const { signal, ...details } = context;

  return new Promise(resolve => {
    if (signal?.aborted) { resolve({ action: 'cancelled' }); return; }
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (pending.has(id)) {
          resolveBreakpoint(id, { action: 'continue' });
        }
      }, timeoutMs);
    }

    const abort = () => resolveBreakpoint(id, { action: 'cancelled' });
    signal?.addEventListener('abort', abort, { once: true });
    pending.set(id, { resolve, timer, signal, abort, context: { ...details, id, timeoutMs } });

    // Notify any registered listeners
    for (const fn of _listeners) {
      try { fn({ ...details, id, timeoutMs }); } catch {}
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
  bp.signal?.removeEventListener('abort', bp.abort);
  pending.delete(id);
  bp.resolve(resolution);
  for (const fn of _clearListeners) { try { fn(id); } catch {} }
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
const _clearListeners = new Set();
export function onBreakpoint(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function onBreakpointCleared(fn) {
  _clearListeners.add(fn);
  return () => _clearListeners.delete(fn);
}
