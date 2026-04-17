// lib/rules-engine.mjs

let counter = 0;
const rules = [];

export function addRule({ host, method = '*', path = '*', action, mockConfig }) {
  const rule = {
    id: `r_${++counter}`,
    host,
    method: method.toUpperCase(),
    path,
    action,
    mockConfig: action === 'mock' ? mockConfig : undefined,
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

export function findMatch(host, method, path) {
  for (const r of rules) {
    if (r.host !== host) continue;
    if (r.method !== '*' && r.method !== method.toUpperCase()) continue;
    if (r.path !== '*' && !path.startsWith(r.path)) continue;
    return r;
  }
  return null;
}
