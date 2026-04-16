// lib/ui-server.mjs
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { listenOnAvailablePort } from './args.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '../ui/index.html'), 'utf8');

/**
 * Serve the dashboard HTML and a /events SSE endpoint.
 *
 * @param {object} opts
 * @param {number} [opts.port] - port to listen on (default 4000)
 * @returns {Promise<{ server: http.Server, broadcast: (record: object) => void }>}
 */
export function createUiServer(opts = {}) {
  const { port = 49997 } = opts;
  const clients = new Set();

  const server = http.createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    // Serve dashboard for all other routes
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  });

  function broadcast(record) {
    const data = `data: ${JSON.stringify(record)}\n\n`;
    for (const client of clients) {
      try { client.write(data); } catch { clients.delete(client); }
    }
  }

  return new Promise(async (resolve, reject) => {
    try {
      const actualPort = await listenOnAvailablePort(server, port);
      resolve({ server, broadcast, port: actualPort });
    } catch (err) {
      reject(err);
    }
  });
}
