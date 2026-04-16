// lib/proxy-core.mjs
import http from 'node:http';
import https from 'node:https';
import { logRequest, logResponse, c } from './logger.mjs';
import { listenOnAvailablePort } from './args.mjs';

/**
 * @param {object} opts
 * @param {number}   opts.port
 * @param {string}  [opts.target]      - if set, only proxy requests to this host
 * @param {boolean} [opts.noForward]
 * @param {boolean} [opts.noHeaders]
 * @param {string}  [opts.mockBody]    - JSON string for --no-forward mock
 * @param {string[]} [opts.ignore]      - hosts/host:ports to skip entirely (no log, pass through)
 * @param {function}[opts.onRequest]   - callback(record) for each completed request
 * @returns {Promise<http.Server>}
 */
export function createProxyServer(opts = {}) {
  const { port = 49999, target, noForward, noHeaders, mockBody, onRequest, ignore = [] } = opts;
  let requestCounter = 0;

  /** @param {string} host @param {number} port */
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
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      const timestamp = new Date().toISOString();
      // Destination: from x-peekr-dest* headers (set by intercept template), or Host header, or target
      const destHost  = req.headers['x-peekr-dest']       || (req.headers['host'] || '').split(':')[0] || target || '';
      const destPort  = parseInt(req.headers['x-peekr-dest-port'] || (req.headers['host'] || '').split(':')[1] || '443', 10);
      const destProto = req.headers['x-peekr-dest-proto'] || 'https';
      const filtered  = target && destHost !== target;

      // Silently pass through ignored hosts/ports — forward but don't log
      if (isIgnored(destHost, destPort)) {
        const cleanReqHeaders = { ...req.headers };
        delete cleanReqHeaders['x-peekr-dest'];
        delete cleanReqHeaders['x-peekr-dest-port'];
        delete cleanReqHeaders['x-peekr-dest-proto'];
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

      // req.url arrives as an absolute URL when set by the intercept template — extract path
      let upstreamPath = req.url;
      try {
        const parsed = new URL(req.url);
        upstreamPath = parsed.pathname + parsed.search;
      } catch { /* already a relative path */ }

      if (!filtered) {
        logRequest({ id, method: req.method, url: upstreamPath, host: `${destProto}://${destHost}:${destPort}`, timestamp, headers: cleanReqHeaders, body, noHeaders });
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
        if (onRequest) onRequest({ id, method: req.method, url: upstreamPath, host: destHost, timestamp, reqHeaders: cleanReqHeaders, reqBody: body, statusCode: 200, resBody: JSON.stringify(mockResponse), direction: 'OUT' });
        return;
      }

      const upstreamHost = target || destHost;
      const upstreamPort = target ? 443 : destPort;
      const useHttps     = target ? true : (destProto === 'https');
      const forwardHeaders = { ...cleanReqHeaders, host: upstreamHost };
      const transport    = useHttps ? https : http;

      const forwardReq = transport.request(
        { hostname: upstreamHost, port: upstreamPort, path: upstreamPath, method: req.method, headers: forwardHeaders },
        forwardRes => {
          const fwdChunks = [];
          forwardRes.on('data', chunk => fwdChunks.push(chunk));
          forwardRes.on('end', () => {
            const forwardBody = Buffer.concat(fwdChunks).toString();
            if (!filtered) logResponse({ statusCode: forwardRes.statusCode, body: forwardBody });
            res.writeHead(forwardRes.statusCode, forwardRes.headers);
            res.end(forwardBody);
            if (onRequest && !filtered) onRequest({ id, method: req.method, url: upstreamPath, host: upstreamHost, timestamp, reqHeaders: cleanReqHeaders, reqBody: body, statusCode: forwardRes.statusCode, resBody: forwardBody, direction: 'OUT' });
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

  return new Promise(async (resolve, reject) => {
    try {
      const actualPort = await listenOnAvailablePort(server, port);
      resolve({ server, port: actualPort });
    } catch (err) {
      reject(err);
    }
  });
}
