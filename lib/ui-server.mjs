// lib/ui-server.mjs
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { listenOnAvailablePort } from './args.mjs';
import { onBreakpoint, onBreakpointCleared, getPendingBreakpoints, resolveBreakpoint, getInterceptEnabled, setInterceptEnabled } from './breakpoint-manager.mjs';

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
export function createUiHandler(opts = {}) {
  const { port = 49997, getLogBuffer, onLogSubscribe, rulesEngine } = opts;
  const clients = new Set();
  const requestBuffer = new Map();

  const handler = (req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('retry: 2000\n\n');
      res.write(`event: intercept-change\ndata: ${JSON.stringify({ enabled: getInterceptEnabled() })}\n\n`);

      // Send buffered requests
      for (const record of requestBuffer.values()) {
        try { res.write(`event: request\ndata: ${JSON.stringify(record)}\n\n`); } catch {}
      }

      // Send buffered log lines
      if (getLogBuffer) {
        for (const entry of getLogBuffer()) {
          try { res.write(`event: app-log\ndata: ${JSON.stringify(entry)}\n\n`); } catch {}
        }
      }

      // Send current rules
      if (rulesEngine) {
        try { res.write(`event: rules-change\ndata: ${JSON.stringify(rulesEngine.getRules())}\n\n`); } catch {}
      }

      // Send currently pending breakpoints on connect (for UI reconnect)
      for (const bp of getPendingBreakpoints()) {
        try { res.write(`event: breakpoint\ndata: ${JSON.stringify(bp)}\n\n`); } catch {}
      }

      clients.add(res);

      // Subscribe to new breakpoints for this SSE client
      const unsubBp = onBreakpoint(bp => {
        try { res.write(`event: breakpoint\ndata: ${JSON.stringify(bp)}\n\n`); } catch {}
      });
      const unsubBpCleared = onBreakpointCleared(id => {
        try { res.write(`event: breakpoint-cleared\ndata: ${JSON.stringify({ id })}\n\n`); } catch {}
      });

      let unsubLog;
      if (onLogSubscribe) {
        unsubLog = onLogSubscribe((entry) => {
          try { res.write(`event: app-log\ndata: ${JSON.stringify(entry)}\n\n`); } catch {}
        });
      }

      req.on('close', () => {
        clients.delete(res);
        if (unsubLog) unsubLog();
        unsubBp();
        unsubBpCleared();
      });
      return;
    }

    if (req.url === '/api/intercept' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ enabled: getInterceptEnabled() }));
      return;
    }

    if (req.url === '/api/intercept' && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json') || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'invalid request origin or content type' })); return;
      }
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (typeof data.enabled !== 'boolean') throw new Error('enabled must be a boolean');
          const released = setInterceptEnabled(data.enabled);
          for (const client of clients) {
            try {
              client.write(`event: intercept-change\ndata: ${JSON.stringify({ enabled: data.enabled })}\n\n`);
            } catch { clients.delete(client); }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ enabled: data.enabled, released: released.length }));
        } catch { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid intercept setting' })); }
      });
      return;
    }

    // ── Rules REST API ──────────────────────────
    if (req.url === '/api/rules' && req.method === 'GET') {
      const body = JSON.stringify(rulesEngine ? rulesEngine.getRules() : []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    if (req.url === '/api/rules' && req.method === 'POST') {
      let chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (!rulesEngine || !data.host || !data.action) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'host and action required' }));
            return;
          }
          const rule = rulesEngine.addRule(data);
          const rulesData = `event: rules-change\ndata: ${JSON.stringify(rulesEngine.getRules())}\n\n`;
          for (const client of clients) {
            try { client.write(rulesData); } catch { clients.delete(client); }
          }
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(rule));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    const ruleIdMatch = req.url.match(/^\/api\/rules\/(.+)$/);

    if (ruleIdMatch && req.method === 'PUT') {
      let chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (!rulesEngine || !rulesEngine.updateRule) {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'updateRule not available' }));
            return;
          }
          const updated = rulesEngine.updateRule(ruleIdMatch[1], data);
          if (!updated) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'rule not found' }));
            return;
          }
          const rulesData = `event: rules-change\ndata: ${JSON.stringify(rulesEngine.getRules())}\n\n`;
          for (const client of clients) {
            try { client.write(rulesData); } catch { clients.delete(client); }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (ruleIdMatch && req.method === 'DELETE') {
      if (rulesEngine && rulesEngine.removeRule(ruleIdMatch[1])) {
        const rulesData = `event: rules-change\ndata: ${JSON.stringify(rulesEngine.getRules())}\n\n`;
        for (const client of clients) {
          try { client.write(rulesData); } catch { clients.delete(client); }
        }
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rule not found' }));
      }
      return;
    }

    // ── Breakpoints REST API ──────────────────────
    if (req.url === '/api/breakpoints/resolve-all' && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json') || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) { res.writeHead(403); res.end(); return; }
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const { action } = JSON.parse(Buffer.concat(chunks).toString());
          if (!['continue', 'block'].includes(action)) throw new Error('invalid action');
          const ids = getPendingBreakpoints().map(bp => bp.id);
          for (const id of ids) resolveBreakpoint(id, { action });
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ resolved: ids.length }));
        } catch { res.writeHead(400); res.end(); }
      });
      return;
    }
    if (req.url === '/api/breakpoints' && req.method === 'GET') {
      const body = JSON.stringify(getPendingBreakpoints());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    const bpResolveMatch = req.url.match(/^\/api\/breakpoints\/(.+)\/resolve$/);
    if (bpResolveMatch && req.method === 'POST') {
      let chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString().trim();
          const data = raw ? JSON.parse(raw) : {};
          const resolved = resolveBreakpoint(bpResolveMatch[1], data);
          if (resolved) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'breakpoint not found or already resolved' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  };

  function broadcast(record) {
    const key = `${record.direction || 'OUT'}:${record.id}`;
    const previous = requestBuffer.get(key);
    const merged = { ...previous, ...record, pending: record.pending === true };
    requestBuffer.set(key, merged);
    const data = `event: request\ndata: ${JSON.stringify(merged)}\n\n`;
    for (const client of clients) {
      try { client.write(data); } catch { clients.delete(client); }
    }
  }

  function broadcastRules() {
    const data = `event: rules-change\ndata: ${JSON.stringify(rulesEngine ? rulesEngine.getRules() : [])}\n\n`;
    for (const client of clients) { try { client.write(data); } catch { clients.delete(client); } }
  }

  return { handler, broadcast, broadcastRules };
}

export function createUiServer(opts = {}) {
  const { port = 49997 } = opts;
  const { handler, broadcast } = createUiHandler(opts);
  const server = http.createServer(handler);
  return new Promise(async (resolve, reject) => {
    try {
      const actualPort = await listenOnAvailablePort(server, port);
      resolve({ server, broadcast, port: actualPort });
    } catch (err) {
      reject(err);
    }
  });
}
