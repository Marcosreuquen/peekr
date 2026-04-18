// lib/proxy-core.mjs
import http from 'node:http';
import https from 'node:https';
import { logRequest, logResponse, c } from './logger.mjs';
import { listenOnAvailablePort } from './args.mjs';
import { findMatch } from './rules-engine.mjs';
import { applyTransform } from './transform-pipeline.mjs';
import { pauseAtBreakpoint } from './breakpoint-manager.mjs';

/**
 * @param {object} opts
 * @param {number}   opts.port
 * @param {string}  [opts.target]
 * @param {boolean} [opts.noForward]
 * @param {boolean} [opts.noHeaders]
 * @param {string}  [opts.mockBody]
 * @param {string[]} [opts.ignore]
 * @param {function}[opts.onRequest]
 * @returns {Promise<{ server: http.Server, port: number }>}
 */
export function createProxyServer(opts = {}) {
  const { port = 49999, target, noForward, noHeaders, mockBody, onRequest, ignore = [] } = opts;
  const uiMode = typeof onRequest === 'function';
  let requestCounter = 0;

  function isIgnored(host, destPort) {
    return ignore.some(pattern => {
      if (pattern.includes(':')) {
        const [h, p] = pattern.split(':');
        return host === h && String(destPort) === p;
      }
      return host === pattern;
    });
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    const id = ++requestCounter;

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      let body = Buffer.concat(chunks).toString();
      const timestamp = new Date().toISOString();

      const destHost  = req.headers['x-peekr-dest']       || (req.headers['host'] || '').split(':')[0] || target || '';
      const destPort  = parseInt(req.headers['x-peekr-dest-port'] || (req.headers['host'] || '').split(':')[1] || '80', 10);
      const inferredProto = destPort === 443 ? 'https' : 'http';
      const destProto = req.headers['x-peekr-dest-proto'] || inferredProto;
      const filtered  = target && destHost !== target;

      // Silently pass through ignored hosts/ports
      if (isIgnored(destHost, destPort)) {
        const cleanReqHeaders = { ...req.headers };
        delete cleanReqHeaders['x-peekr-dest'];
        delete cleanReqHeaders['x-peekr-dest-port'];
        delete cleanReqHeaders['x-peekr-dest-proto'];
        delete cleanReqHeaders['accept-encoding'];
        let upstreamPath = req.url;
        try { const p = new URL(req.url); upstreamPath = p.pathname + p.search; } catch {}
        const useHttps = destProto === 'https';
        const transport = useHttps ? https : http;
        const fwdReq = transport.request(
          { hostname: destHost, port: destPort, path: upstreamPath, method: req.method, headers: { ...cleanReqHeaders, host: destHost } },
          fwdRes => {
            const chunks = [];
            fwdRes.on('data', c => chunks.push(c));
            fwdRes.on('end', () => { res.writeHead(fwdRes.statusCode, fwdRes.headers); res.end(Buffer.concat(chunks)); });
          }
        );
        fwdReq.on('error', err => { res.writeHead(502); res.end(JSON.stringify({ error: err.message })); });
        if (body) fwdReq.write(body);
        fwdReq.end();
        return;
      }

      const cleanReqHeaders = { ...req.headers };
      delete cleanReqHeaders['x-peekr-dest'];
      delete cleanReqHeaders['x-peekr-dest-port'];
      delete cleanReqHeaders['x-peekr-dest-proto'];
      delete cleanReqHeaders['accept-encoding'];

      // Loop detection
      const loopPorts = [port];
      if ((destHost === '127.0.0.1' || destHost === 'localhost') && loopPorts.includes(destPort)) {
        console.error(c('red', `\n[#${id}] LOOP DETECTED: request targets proxy itself (${destHost}:${destPort}). Check for double-patching.`));
        res.writeHead(508, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'proxy loop detected', detail: `destination ${destHost}:${destPort} is the peekr proxy itself` }));
        return;
      }

      let upstreamPath = req.url;
      try {
        const parsed = new URL(req.url);
        upstreamPath = parsed.pathname + parsed.search;
      } catch {}

      // ── Dynamic rules (block / mock / transform / breakpoint) ──
      const rule = findMatch(destHost, req.method, upstreamPath, 'OUT');
      if (rule) {
        if (rule.action === 'block') {
          const blockBody = JSON.stringify({ error: 'blocked by rule', rule: rule.id });
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(blockBody);
          if (onRequest) onRequest({ id, method: req.method, url: upstreamPath, host: destHost, timestamp, reqHeaders: cleanReqHeaders, reqBody: body, statusCode: 403, resHeaders: { 'content-type': 'application/json' }, resBody: blockBody, durationMs: 0, responseSize: Buffer.byteLength(blockBody), direction: 'OUT', ruleAction: 'blocked' });
          return;
        }
        if (rule.action === 'mock') {
          const mc = rule.mockConfig || {};
          const mockStatus = mc.status || 200;
          const mockResponseBody = mc.body || '{}';
          const mockHeaders = { 'Content-Type': 'application/json', ...(mc.headers || {}) };
          res.writeHead(mockStatus, mockHeaders);
          res.end(mockResponseBody);
          if (onRequest) onRequest({ id, method: req.method, url: upstreamPath, host: destHost, timestamp, reqHeaders: cleanReqHeaders, reqBody: body, statusCode: mockStatus, resHeaders: mockHeaders, resBody: mockResponseBody, durationMs: 0, responseSize: Buffer.byteLength(mockResponseBody), direction: 'OUT', ruleAction: 'mocked' });
          return;
        }
      }

      // ── Request-phase transform ──
      const reqCtx = { host: destHost, method: req.method, path: upstreamPath, headers: cleanReqHeaders, body, statusCode: 0 };
      applyTransform('request', 'OUT', reqCtx);

      // ── Request-phase breakpoint ──
      // Re-fetch rule: rule above only short-circuits block/mock; breakpoint falls through to here
      const bpReqRule = findMatch(destHost, req.method, upstreamPath, 'OUT');
      if (bpReqRule && bpReqRule.action === 'breakpoint') {
        const bpPhase = bpReqRule.phase || 'both';
        if (bpPhase === 'request' || bpPhase === 'both') {
          const resolution = await pauseAtBreakpoint({ ...reqCtx, direction: 'OUT', phase: 'request', timeoutMs: bpReqRule.timeoutMs ?? 30000 });
          if (resolution.action === 'block') {
            const blockBody = JSON.stringify({ error: 'blocked at breakpoint' });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(blockBody);
            if (onRequest) onRequest({ id, method: req.method, url: upstreamPath, host: destHost, timestamp, reqHeaders: reqCtx.headers, reqBody: reqCtx.body, statusCode: 403, resHeaders: {}, resBody: blockBody, durationMs: 0, responseSize: Buffer.byteLength(blockBody), direction: 'OUT', ruleAction: 'blocked' });
            return;
          }
          if (resolution.action === 'mock') {
            const edits = resolution.edits || {};
            const mockStatus = edits.status || 200;
            const bpMockBody = edits.body || '{}';
            const bpMockHeaders = { 'Content-Type': 'application/json', ...(edits.headers || {}) };
            res.writeHead(mockStatus, bpMockHeaders);
            res.end(bpMockBody);
            if (onRequest) onRequest({ id, method: req.method, url: upstreamPath, host: destHost, timestamp, reqHeaders: reqCtx.headers, reqBody: reqCtx.body, statusCode: mockStatus, resHeaders: bpMockHeaders, resBody: bpMockBody, durationMs: 0, responseSize: Buffer.byteLength(bpMockBody), direction: 'OUT', ruleAction: 'mocked' });
            return;
          }
          if (resolution.action === 'edit' && resolution.edits) {
            const e = resolution.edits;
            if (e.headers) Object.assign(reqCtx.headers, e.headers);
            if (e.body != null) reqCtx.body = e.body;
          }
          // 'continue' and 'log-only': fall through
        }
      }

      if (!filtered && !uiMode) {
        logRequest({ id, method: req.method, url: upstreamPath, host: `${destProto}://${destHost}:${destPort}`, timestamp, headers: reqCtx.headers, body: reqCtx.body, noHeaders });
      }

      if (noForward) {
        let mockResponse = {};
        if (mockBody) {
          try { mockResponse = JSON.parse(mockBody); }
          catch { console.error(c('red', `[#${id}] --mock is not valid JSON, using {}`)); }
        }
        if (!filtered && !uiMode) {
          console.log(c('dim', `\n[#${id}] --no-forward: returning mock 200`));
          console.log('='.repeat(80) + '\n');
        }
        const mockStr = JSON.stringify(mockResponse);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(mockStr);
        if (onRequest) onRequest({ id, method: req.method, url: upstreamPath, host: destHost, timestamp, reqHeaders: reqCtx.headers, reqBody: reqCtx.body, statusCode: 200, resHeaders: { 'content-type': 'application/json' }, resBody: mockStr, durationMs: 0, responseSize: Buffer.byteLength(mockStr), direction: 'OUT' });
        return;
      }

      const upstreamHost = target || destHost;
      const upstreamPort = target ? 443 : destPort;
      const useHttps     = target ? true : (destProto === 'https');
      const forwardHeaders = { ...reqCtx.headers, host: upstreamHost };
      const transport    = useHttps ? https : http;

      const startTime = Date.now();
      const forwardReq = transport.request(
        { hostname: upstreamHost, port: upstreamPort, path: upstreamPath, method: req.method, headers: forwardHeaders },
        async forwardRes => {
          const fwdChunks = [];
          forwardRes.on('data', chunk => fwdChunks.push(chunk));
          forwardRes.on('end', async () => {
            let forwardBody = Buffer.concat(fwdChunks).toString();
            const durationMs = Date.now() - startTime;

            // ── Response-phase transform ──
            const resCtx = { host: upstreamHost, method: req.method, path: upstreamPath, headers: { ...forwardRes.headers }, body: forwardBody, statusCode: forwardRes.statusCode };
            applyTransform('response', 'OUT', resCtx);

            // ── Response-phase breakpoint ──
            const bpResRule = findMatch(destHost, req.method, upstreamPath, 'OUT');
            if (bpResRule && bpResRule.action === 'breakpoint') {
              const bpPhase = bpResRule.phase || 'both';
              if (bpPhase === 'response' || bpPhase === 'both') {
                const resolution = await pauseAtBreakpoint({ ...resCtx, direction: 'OUT', phase: 'response', timeoutMs: bpResRule.timeoutMs ?? 30000 });
                if (resolution.action === 'block') {
                  const blockBody = JSON.stringify({ error: 'blocked at breakpoint' });
                  res.writeHead(403, { 'Content-Type': 'application/json' });
                  res.end(blockBody);
                  if (onRequest) onRequest({ id, method: req.method, url: upstreamPath, host: destHost, timestamp, reqHeaders: reqCtx.headers, reqBody: reqCtx.body, statusCode: 403, resHeaders: {}, resBody: blockBody, durationMs, responseSize: Buffer.byteLength(blockBody), direction: 'OUT', ruleAction: 'blocked' });
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
            }

            if (!filtered && !uiMode) logResponse({ statusCode: resCtx.statusCode, body: resCtx.body });
            res.writeHead(resCtx.statusCode, resCtx.headers);
            res.end(resCtx.body);
            const responseSize = Buffer.byteLength(resCtx.body);
            if (onRequest && !filtered) onRequest({ id, method: req.method, url: upstreamPath, host: upstreamHost, timestamp, reqHeaders: reqCtx.headers, reqBody: reqCtx.body, statusCode: resCtx.statusCode, resHeaders: resCtx.headers, resBody: resCtx.body, durationMs, responseSize, direction: 'OUT' });
          });
        }
      );

      forwardReq.on('error', err => {
        console.error(c('red', `\n[#${id}] FORWARD ERROR: ${err.message}`));
        console.log('='.repeat(80) + '\n');
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'proxy forward failed', detail: err.message }));
      });

      forwardReq.write(reqCtx.body || '');
      forwardReq.end();
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
