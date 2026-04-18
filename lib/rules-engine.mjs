// lib/rules-engine.mjs

let counter = 0;
const rules = [];

/**
 * @param {object} opts
 * @param {string}  opts.host
 * @param {string} [opts.method]      - HTTP method or '*' (default '*')
 * @param {string} [opts.path]        - path prefix or '*' (default '*')
 * @param {string}  opts.action       - 'block' | 'mock' | 'transform' | 'breakpoint'
 * @param {string} [opts.direction]   - 'IN' | 'OUT' | 'BOTH' (default 'BOTH')
 * @param {string} [opts.phase]       - 'request' | 'response' | 'both' (default 'both')
 * @param {object} [opts.mockConfig]  - for action=mock: { status, body, headers }
 * @param {object} [opts.reqTransform]  - for action=transform: { headers: { set, remove }, body }
 * @param {object} [opts.resTransform]  - for action=transform: { status, headers: { set, remove }, body }
 * @param {number} [opts.timeoutMs]   - for action=breakpoint (default 30000)
 */
export function addRule({ host, method = '*', path = '*', action, direction = 'BOTH', phase = 'both', mockConfig, reqTransform, resTransform, timeoutMs }) {
  const rule = {
    id: `r_${++counter}`,
    host,
    method: method.toUpperCase(),
    path,
    action,
    direction: direction.toUpperCase(),
    phase,
    mockConfig: action === 'mock' ? mockConfig : undefined,
    reqTransform: action === 'transform' ? reqTransform : undefined,
    resTransform: action === 'transform' ? resTransform : undefined,
    timeoutMs: action === 'breakpoint' ? (timeoutMs ?? 30000) : undefined,
  };
  rules.push(rule);
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
    if (r.direction !== 'BOTH' && r.direction !== direction.toUpperCase()) continue;
    return r;
  }
  return null;
}
