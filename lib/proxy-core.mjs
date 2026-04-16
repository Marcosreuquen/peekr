// lib/proxy-core.mjs
import http from 'node:http';
import https from 'node:https';
import { logRequest, logResponse, c } from './logger.mjs';

/**
 * @param {object} opts
 * @param {number}   opts.port
 * @param {string}  [opts.target]      - if set, only proxy requests to this host
 * @param {boolean} [opts.noForward]
 * @param {boolean} [opts.noHeaders]
 * @param {string}  [opts.mockBody]    - JSON string for --no-forward mock
 * @param {function}[opts.onRequest]   - callback(record) for each completed request
 * @returns {Promise<http.Server>}
 */
export function createProxyServer(opts = {}) {
  const { port = 9999, target, noForward, noHeaders, mockBody, onRequest } = opts;
  let requestCounter = 0;

  const server = http.createServer((req, res) => {
    const chunks = [];
    const id = ++requestCounter;

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      const timestamp = new Date().toISOString();
      // Destination host: from x-peekr-dest header (set by intercept), or Host header, or target
      const destHost = req.headers['x-peekr-dest'] || req.headers['host'] || target || '';
      const filtered = target && destHost !== target;

      const cleanReqHeaders = { ...req.headers };
      delete cleanReqHeaders['x-peekr-dest'];
      delete cleanReqHeaders['x-peekr-dest-port'];
      delete cleanReqHeaders['x-peekr-dest-proto'];

      if (!filtered) {
        logRequest({ id, method: req.method, url: req.url, host: destHost, timestamp, headers: cleanReqHeaders, body, noHeaders });
      }

      if (noForward) {
        let mockResponse = {};
        if (mockBody) {
          try { mockResponse = JSON.parse(mockBody); }
          catch { console.error(c('red', `[#${id}] --mock is not valid JSON, using {}`)); }
        }
        if (!filtered) {
          console.log(c('dim', `\n[#${id}] --no-forward: returning mock 200`));
          console.log('='.repeat(80) + '\n');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockResponse));
        if (onRequest) onRequest({ id, method: req.method, url: req.url, host: destHost, timestamp, reqHeaders: cleanReqHeaders, reqBody: body, statusCode: 200, resBody: JSON.stringify(mockResponse), direction: 'OUT' });
        return;
      }

      const upstreamHost = target || destHost;
      const forwardHeaders = { ...cleanReqHeaders, host: upstreamHost };

      const forwardReq = https.request(
        { hostname: upstreamHost, port: 443, path: req.url, method: req.method, headers: forwardHeaders },
        forwardRes => {
          const fwdChunks = [];
          forwardRes.on('data', chunk => fwdChunks.push(chunk));
          forwardRes.on('end', () => {
            const forwardBody = Buffer.concat(fwdChunks).toString();
            if (!filtered) logResponse({ statusCode: forwardRes.statusCode, body: forwardBody });
            res.writeHead(forwardRes.statusCode, forwardRes.headers);
            res.end(forwardBody);
            if (onRequest && !filtered) onRequest({ id, method: req.method, url: req.url, host: upstreamHost, timestamp, reqHeaders: cleanReqHeaders, reqBody: body, statusCode: forwardRes.statusCode, resBody: forwardBody, direction: 'OUT' });
          });
        }
      );

      forwardReq.on('error', err => {
        console.error(c('red', `\n[#${id}] FORWARD ERROR: ${err.message}`));
        console.log('='.repeat(80) + '\n');
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'proxy forward failed', detail: err.message }));
      });

      forwardReq.write(body);
      forwardReq.end();
    });
  });

  return new Promise(resolve => server.listen(port, () => resolve(server)));
}
