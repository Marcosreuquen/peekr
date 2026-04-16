// lib/reverse-proxy.mjs
import http from 'node:http';
import { logRequest, logResponse, c } from './logger.mjs';

/**
 * Create a reverse proxy that sits in front of the user's app.
 * Logs incoming requests and their responses.
 *
 * @param {object} opts
 * @param {number}   opts.port       - port this reverse proxy listens on (default 8888)
 * @param {number}   opts.appPort    - port where the user's app listens (default 3000)
 * @param {boolean} [opts.noHeaders]
 * @param {function}[opts.onRequest] - callback(record) for dashboard SSE
 * @returns {Promise<http.Server>}
 */
export function createReverseProxy(opts = {}) {
  const { port = 8888, appPort = 3000, noHeaders, onRequest } = opts;
  let counter = 0;

  const server = http.createServer((req, res) => {
    const chunks = [];
    const id = ++counter;
    const timestamp = new Date().toISOString();

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      logRequest({ id, method: req.method, url: req.url, host: `→app:${appPort}`, timestamp, headers: req.headers, body, noHeaders });

      const fwdReq = http.request(
        { hostname: '127.0.0.1', port: appPort, path: req.url, method: req.method, headers: req.headers },
        fwdRes => {
          const fwdChunks = [];
          fwdRes.on('data', chunk => fwdChunks.push(chunk));
          fwdRes.on('end', () => {
            const fwdBody = Buffer.concat(fwdChunks).toString();
            logResponse({ statusCode: fwdRes.statusCode, body: fwdBody });
            res.writeHead(fwdRes.statusCode, fwdRes.headers);
            res.end(fwdBody);
            if (onRequest) onRequest({
              id,
              direction: 'IN',
              method: req.method,
              url: req.url,
              host: req.headers['host'] || '',
              timestamp,
              reqHeaders: req.headers,
              reqBody: body,
              statusCode: fwdRes.statusCode,
              resBody: fwdBody,
            });
          });
        }
      );

      fwdReq.on('error', err => {
        console.error(c('red', `\n[IN #${id}] FORWARD ERROR: ${err.message}`));
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'reverse proxy failed', detail: err.message }));
      });

      fwdReq.write(body);
      fwdReq.end();
    });
  });

  return new Promise(resolve => server.listen(port, () => resolve(server)));
}
