// lib/reverse-proxy.mjs
import http from 'node:http';
import { logRequest, logResponse, c } from './logger.mjs';
import { listenOnAvailablePort } from './args.mjs';
import { findMatch } from './rules-engine.mjs';
import { applyModifyConfig } from './modify-pipeline.mjs';
import { pauseAtBreakpoint } from './breakpoint-manager.mjs';

/**
 * @param {object} opts
 * @param {number}   opts.port
 * @param {number}   opts.appPort
 * @param {boolean} [opts.noHeaders]
 * @param {function}[opts.onRequest]
 * @returns {Promise<{ server: http.Server, port: number }>}
 */
export function createReverseProxy(opts = {}) {
  const { port = 49998, appPort = 3000, noHeaders, onRequest } = opts;
  const uiMode = typeof onRequest === 'function';
  let counter = 0;

  const server = http.createServer((req, res) => {
    const chunks = [];
    const id = ++counter;
    const timestamp = new Date().toISOString();
    const startTime = Date.now();

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => { try {
      let body = Buffer.concat(chunks).toString();
      const host = (req.headers['host'] || '').split(':')[0] || '127.0.0.1';

      // ── Rules: block / mock ──
      const rule = findMatch(host, req.method, req.url, 'IN');
      if (rule) {
        if (rule.action === 'block') {
          const blockBody = JSON.stringify({ error: 'blocked by rule', rule: rule.id });
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(blockBody);
          if (onRequest) onRequest({ id, direction: 'IN', method: req.method, url: req.url, host, timestamp, reqHeaders: req.headers, reqBody: body, statusCode: 403, resHeaders: { 'content-type': 'application/json' }, resBody: blockBody, durationMs: 0, responseSize: Buffer.byteLength(blockBody), ruleAction: 'blocked' });
          return;
        }
        if (rule.action === 'modify' && rule.modifyConfig?.noForward) {
          const mc = rule.modifyConfig;
          const mockStatus = mc.resStatus || 200;
          const mockResponseBody = mc.resBody != null ? mc.resBody : '{}';
          const mockResHeaders = { 'Content-Type': 'application/json', ...(mc.resHeaders?.set || {}) };
          mockResHeaders['content-length'] = String(Buffer.byteLength(mockResponseBody));
          res.writeHead(mockStatus, mockResHeaders);
          res.end(mockResponseBody);
          if (onRequest) onRequest({ id, direction: 'IN', method: req.method, url: req.url, host, timestamp, reqHeaders: req.headers, reqBody: body, statusCode: mockStatus, resHeaders: mockResHeaders, resBody: mockResponseBody, durationMs: 0, responseSize: Buffer.byteLength(mockResponseBody), ruleAction: 'mocked' });
          return;
        }
      }

      // ── Request-phase transform ──
      const reqCtx = { host, method: req.method, path: req.url, headers: { ...req.headers }, body, statusCode: 0 };
      if (rule && rule.action === 'modify') applyModifyConfig('request', reqCtx, rule.modifyConfig);

      // ── Request-phase breakpoint ──
      if (rule && rule.action === 'breakpoint') {
          const resolution = await pauseAtBreakpoint({ ...reqCtx, direction: 'IN', phase: 'request', timeoutMs: rule.timeoutMs ?? 30000 });
          if (resolution.action === 'block') {
            const blockBody = JSON.stringify({ error: 'blocked at breakpoint' });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(blockBody);
            if (onRequest) onRequest({ id, direction: 'IN', method: req.method, url: req.url, host, timestamp, reqHeaders: reqCtx.headers, reqBody: reqCtx.body, statusCode: 403, resHeaders: {}, resBody: blockBody, durationMs: 0, responseSize: Buffer.byteLength(blockBody), ruleAction: 'blocked' });
            return;
          }
          if (resolution.action === 'mock') {
            const edits = resolution.edits || {};
            const mockStatus = edits.status || 200;
            const mockBody2 = edits.body || '{}';
            const mockHeaders2 = { 'Content-Type': 'application/json', ...(edits.headers || {}) };
            res.writeHead(mockStatus, mockHeaders2);
            res.end(mockBody2);
            if (onRequest) onRequest({ id, direction: 'IN', method: req.method, url: req.url, host, timestamp, reqHeaders: reqCtx.headers, reqBody: reqCtx.body, statusCode: mockStatus, resHeaders: mockHeaders2, resBody: mockBody2, durationMs: 0, responseSize: Buffer.byteLength(mockBody2), ruleAction: 'mocked' });
            return;
          }
          if (resolution.action === 'edit' && resolution.edits) {
            const e = resolution.edits;
            if (e.headers) Object.assign(reqCtx.headers, e.headers);
            if (e.body != null) reqCtx.body = e.body;
          }
      }

      if (!uiMode) {
        logRequest({ id, method: req.method, url: req.url, host: `→app:${appPort}`, timestamp, headers: reqCtx.headers, body: reqCtx.body, noHeaders });
      }

      const fwdReq = http.request(
        { hostname: '127.0.0.1', port: appPort, path: req.url, method: req.method, headers: reqCtx.headers },
        async fwdRes => { try {
          const fwdChunks = [];
          fwdRes.on('data', chunk => fwdChunks.push(chunk));
          fwdRes.on('end', async () => { try {
            let fwdBody = Buffer.concat(fwdChunks).toString();
            const durationMs = Date.now() - startTime;

            // ── Response-phase transform ──
            const resCtx = { host, method: req.method, path: req.url, headers: { ...fwdRes.headers }, body: fwdBody, statusCode: fwdRes.statusCode };
            if (rule && rule.action === 'modify') applyModifyConfig('response', resCtx, rule.modifyConfig);

            // ── Response-phase breakpoint ──
            if (rule && rule.action === 'breakpoint') {
                const resolution = await pauseAtBreakpoint({ ...resCtx, direction: 'IN', phase: 'response', timeoutMs: rule.timeoutMs ?? 30000 });
                if (resolution.action === 'block') {
                  const blockBody = JSON.stringify({ error: 'blocked at breakpoint' });
                  res.writeHead(403, { 'Content-Type': 'application/json' });
                  res.end(blockBody);
                  if (onRequest) onRequest({ id, direction: 'IN', method: req.method, url: req.url, host, timestamp, reqHeaders: reqCtx.headers, reqBody: reqCtx.body, statusCode: 403, resHeaders: {}, resBody: blockBody, durationMs, responseSize: Buffer.byteLength(blockBody), ruleAction: 'blocked' });
                  return;
                }
                if (resolution.action === 'mock') {
                  const edits = resolution.edits || {};
                  resCtx.statusCode = edits.status || 200;
                  resCtx.body = edits.body || '{}';
                  if (edits.headers) Object.assign(resCtx.headers, edits.headers);
                } else if (resolution.action === 'edit' && resolution.edits) {
                  const e = resolution.edits;
                  if (e.status != null) resCtx.statusCode = e.status;
                  if (e.headers) Object.assign(resCtx.headers, e.headers);
                  if (e.body != null) resCtx.body = e.body;
                }
                // 'continue' and 'log-only': fall through
            }

            if (!uiMode) logResponse({ statusCode: resCtx.statusCode, body: resCtx.body });
            res.writeHead(resCtx.statusCode, resCtx.headers);
            res.end(resCtx.body);
            const responseSize = Buffer.byteLength(resCtx.body);
            if (onRequest) onRequest({ id, direction: 'IN', method: req.method, url: req.url, host, timestamp, reqHeaders: reqCtx.headers, reqBody: reqCtx.body, statusCode: resCtx.statusCode, resHeaders: resCtx.headers, resBody: resCtx.body, durationMs, responseSize });
          } catch (err) {
            console.error(c('red', `\n[IN #${id}] UNHANDLED ERROR in response handler: ${err.message}`));
            if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'internal proxy error', detail: err.message })); }
          }
          });
        } catch (err) {
          console.error(c('red', `\n[IN #${id}] UNHANDLED ERROR in fwdRes callback: ${err.message}`));
          if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'internal proxy error', detail: err.message })); }
        }
      }
      );

      fwdReq.on('error', err => {
        if (!uiMode) console.error(c('red', `\n[IN #${id}] FORWARD ERROR: ${err.message}`));
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'reverse proxy failed', detail: err.message }));
      });

      if (reqCtx.body) fwdReq.write(reqCtx.body);
      fwdReq.end();
    } catch (err) {
      console.error(c('red', `\n[IN #${id}] UNHANDLED ERROR in request handler: ${err.message}`));
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'internal proxy error', detail: err.message })); }
    }
    });
  });

  return new Promise(async (resolve, reject) => {
    try {
      const actualPort = await listenOnAvailablePort(server, port);
      resolve({ server, port: actualPort });
    } catch (err) {
      reject(err);
    }
  });
}
