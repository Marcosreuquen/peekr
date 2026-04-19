// lib/modify-pipeline.mjs

/**
 * Apply a modify rule's config to the given context object.
 *
 * For request phase: applies reqHeaders and reqBody.
 * For response phase: applies resStatus, resHeaders, resBody.
 * Always updates Content-Length when body is replaced.
 *
 * @param {'request'|'response'} phase
 * @param {object} context  - mutable: { host, method, path, headers, body, statusCode }
 * @param {object} modifyConfig - from rule.modifyConfig
 * @returns {object} the same context object, possibly mutated
 */
export function applyModifyConfig(phase, context, modifyConfig) {
  if (!context || !modifyConfig) return context;
  context.headers ??= {};

  if (phase === 'request') {
    const rh = modifyConfig.reqHeaders || {};
    if (rh.set) {
      for (const [k, v] of Object.entries(rh.set)) {
        context.headers[k.toLowerCase()] = v;
      }
    }
    if (rh.remove) rh.remove.forEach(k => delete context.headers[k.toLowerCase()]);
    if (modifyConfig.reqBody != null) {
      const body = typeof modifyConfig.reqBody === 'object'
        ? JSON.stringify(modifyConfig.reqBody)
        : modifyConfig.reqBody;
      context.body = body;
      context.headers['content-length'] = String(Buffer.byteLength(body));
    }
  }

  if (phase === 'response') {
    if (modifyConfig.resStatus != null) context.statusCode = modifyConfig.resStatus;
    const rh = modifyConfig.resHeaders || {};
    if (rh.set) {
      for (const [k, v] of Object.entries(rh.set)) {
        context.headers[k.toLowerCase()] = v;
      }
    }
    if (rh.remove) rh.remove.forEach(k => delete context.headers[k.toLowerCase()]);
    if (modifyConfig.resBody != null) {
      const body = typeof modifyConfig.resBody === 'object'
        ? JSON.stringify(modifyConfig.resBody)
        : modifyConfig.resBody;
      context.body = body;
      context.headers['content-length'] = String(Buffer.byteLength(body));
    }
  }

  return context;
}
