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
export function addRule({ host, method = '*', path = '*', action, direction = 'OUT', modifyConfig, timeoutMs, sourceService, destinationPort, redirectUrl }) {
  if (action === 'redirect') { if (direction.toUpperCase() !== 'OUT') throw new Error('redirect is only supported for outgoing requests'); validateRedirect(redirectUrl); }
  if (destinationPort != null && (!Number.isInteger(Number(destinationPort)) || Number(destinationPort) < 1 || Number(destinationPort) > 65535)) throw new Error('invalid destination port');
  const rule = {
    id: `r_${++counter}`,
    host,
    method: method.toUpperCase(),
    path,
    action,
    direction: direction.toUpperCase(),
    modifyConfig: action === 'modify' ? (modifyConfig || {}) : undefined,
    timeoutMs: action === 'breakpoint' ? (timeoutMs ?? 30000) : undefined,
    sourceService: sourceService || undefined,
    destinationPort: destinationPort == null ? undefined : Number(destinationPort),
    redirectUrl: action === 'redirect' ? redirectUrl : undefined,
  };
  rules.push(rule);
  return rule;
}

function validateRedirect(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('redirectUrl must be an HTTP or HTTPS origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('redirectUrl must be an HTTP or HTTPS origin without a path');
}

export function updateRule(id, updates) {
  const rule = rules.find(r => r.id === id);
  if (!rule) return null;
  const { host, method, path, action, direction, modifyConfig, timeoutMs, sourceService, destinationPort, redirectUrl } = updates;
  if ((action || rule.action) === 'redirect') { if ((direction || rule.direction).toUpperCase() !== 'OUT') throw new Error('redirect is only supported for outgoing requests'); validateRedirect(redirectUrl ?? rule.redirectUrl); }
  if (destinationPort != null && (!Number.isInteger(Number(destinationPort)) || Number(destinationPort) < 1 || Number(destinationPort) > 65535)) throw new Error('invalid destination port');
  if (host !== undefined) rule.host = host;
  if (method !== undefined) rule.method = method.toUpperCase();
  if (path !== undefined) rule.path = path;
  if (direction !== undefined) rule.direction = direction.toUpperCase();
  if (sourceService !== undefined) rule.sourceService = sourceService || undefined;
  if (destinationPort !== undefined) rule.destinationPort = destinationPort == null ? undefined : Number(destinationPort);
  if (redirectUrl !== undefined) rule.redirectUrl = redirectUrl;
  if (action !== undefined) {
    rule.action = action;
    rule.modifyConfig = action === 'modify' ? (modifyConfig ?? rule.modifyConfig ?? {}) : undefined;
    rule.timeoutMs = action === 'breakpoint' ? (timeoutMs ?? rule.timeoutMs ?? 30000) : undefined;
  } else {
    // action unchanged: allow updating modifyConfig/timeoutMs independently
    if (modifyConfig !== undefined && rule.action === 'modify') rule.modifyConfig = modifyConfig;
    if (timeoutMs !== undefined && rule.action === 'breakpoint') rule.timeoutMs = timeoutMs;
  }
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
export function findMatch(host, method, path, direction = 'OUT', sourceService, destinationPort) {
  for (const r of rules) {
    if (r.host !== '*' && r.host !== host) continue;
    if (r.method !== '*' && r.method !== method.toUpperCase()) continue;
    if (r.path !== '*' && !path.startsWith(r.path)) continue;
    if (r.direction !== direction.toUpperCase()) continue;
    if (r.sourceService && r.sourceService !== sourceService) continue;
    if (r.destinationPort != null && r.destinationPort !== Number(destinationPort)) continue;
    return r;
  }
  return null;
}
