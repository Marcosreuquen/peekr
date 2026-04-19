// lib/rules-engine.mjs

let counter = 0;
const rules = [];

/**
 * @param {object} opts
 * @param {string}  opts.host
 * @param {string} [opts.method]       - HTTP method or '*' (default '*')
 * @param {string} [opts.path]         - path prefix or '*' (default '*')
 * @param {string}  opts.action        - 'block' | 'modify' | 'breakpoint'
 * @param {string} [opts.direction]    - 'OUT' | 'IN' (default 'OUT')
 * @param {object} [opts.modifyConfig] - for action=modify: { noForward, reqHeaders, reqBody, resStatus, resHeaders, resBody }
 * @param {number} [opts.timeoutMs]    - for action=breakpoint (default 30000)
 */
export function addRule({ host, method = '*', path = '*', action, direction = 'OUT', modifyConfig, timeoutMs }) {
  const rule = {
    id: `r_${++counter}`,
    host,
    method: method.toUpperCase(),
    path,
    action,
    direction: direction.toUpperCase(),
    modifyConfig: action === 'modify' ? (modifyConfig || {}) : undefined,
    timeoutMs: action === 'breakpoint' ? (timeoutMs ?? 30000) : undefined,
  };
  rules.push(rule);
  return rule;
}

export function updateRule(id, updates) {
  const rule = rules.find(r => r.id === id);
  if (!rule) return null;
  const { host, method, path, action, direction, modifyConfig, timeoutMs } = updates;
  if (host !== undefined) rule.host = host;
  if (method !== undefined) rule.method = method.toUpperCase();
  if (path !== undefined) rule.path = path;
  if (action !== undefined) rule.action = action;
  if (direction !== undefined) rule.direction = direction.toUpperCase();
  rule.modifyConfig = action === 'modify' ? (modifyConfig || rule.modifyConfig || {}) : undefined;
  rule.timeoutMs = action === 'breakpoint' ? (timeoutMs ?? rule.timeoutMs ?? 30000) : undefined;
  return rule;
}

export function removeRule(id) {
  const idx = rules.findIndex(r => r.id === id);
  if (idx === -1) return false;
  rules.splice(idx, 1);
  return true;
}

export function getRules() {
  return rules.slice();
}

/**
 * @param {string} host
 * @param {string} method
 * @param {string} path
 * @param {string} direction - 'IN' | 'OUT'
 */
export function findMatch(host, method, path, direction = 'OUT') {
  for (const r of rules) {
    if (r.host !== host) continue;
    if (r.method !== '*' && r.method !== method.toUpperCase()) continue;
    if (r.path !== '*' && !path.startsWith(r.path)) continue;
    if (r.direction !== direction.toUpperCase()) continue;
    return r;
  }
  return null;
}
