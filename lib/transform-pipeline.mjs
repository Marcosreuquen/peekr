// lib/transform-pipeline.mjs
import { findMatch } from './rules-engine.mjs';

/**
 * Applies a transform rule (if any matches) to the given context object in place.
 *
 * @param {'request'|'response'} phase
 * @param {'IN'|'OUT'} direction
 * @param {object} context - mutable: { host, method, path, headers, body, statusCode }
 * @returns {object} the same context object, possibly mutated
 */
export function applyTransform(phase, direction, context) {
  const rule = findMatch(context.host, context.method, context.path, direction);
  if (!rule || rule.action !== 'transform') return context;

  const rulePhase = rule.phase || 'both';
  const phaseMatches = rulePhase === 'both' || rulePhase === phase;
  if (!phaseMatches) return context;

  if (phase === 'request' && rule.reqTransform) {
    const t = rule.reqTransform;
    if (t.headers) {
      if (t.headers.set) Object.assign(context.headers, t.headers.set);
      if (t.headers.remove) t.headers.remove.forEach(k => delete context.headers[k.toLowerCase()]);
    }
    if (t.body != null) context.body = typeof t.body === 'object' ? JSON.stringify(t.body) : t.body;
  }

  if (phase === 'response' && rule.resTransform) {
    const t = rule.resTransform;
    if (t.status != null) context.statusCode = t.status;
    if (t.headers) {
      if (t.headers.set) Object.assign(context.headers, t.headers.set);
      if (t.headers.remove) t.headers.remove.forEach(k => delete context.headers[k.toLowerCase()]);
    }
    if (t.body != null) context.body = typeof t.body === 'object' ? JSON.stringify(t.body) : t.body;
  }

  return context;
}
