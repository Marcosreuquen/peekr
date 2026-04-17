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
 * @param {number} [opts.port]
 * @param {function} [opts.getLogBuffer]
 * @param {function} [opts.onLogSubscribe]
 * @returns {Promise<{ server: http.Server, broadcast: (record: object) => void, port: number }>}
 */
export function createUiServer(opts = {}) {
  const { port = 49997, getLogBuffer, onLogSubscribe } = opts;
  const clients = new Set();
  const requestBuffer = [];

  const server = http.createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('retry: 2000\n\n');

      // Send buffered requests
      for (const record of requestBuffer) {
        try { res.write(`event: request\ndata: ${JSON.stringify(record)}\n\n`); } catch {}
      }

      // Send buffered log lines
      if (getLogBuffer) {
        for (const entry of getLogBuffer()) {
          try { res.write(`event: app-log\ndata: ${JSON.stringify(entry)}\n\n`); } catch {}
        }
      }

      clients.add(res);

      let unsubLog;
      if (onLogSubscribe) {
        unsubLog = onLogSubscribe((entry) => {
          try { res.write(`event: app-log\ndata: ${JSON.stringify(entry)}\n\n`); } catch {}
        });
      }

      req.on('close', () => {
        clients.delete(res);
        if (unsubLog) unsubLog();
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  });

  function broadcast(record) {
    requestBuffer.push(record);
    const data = `event: request\ndata: ${JSON.stringify(record)}\n\n`;
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
