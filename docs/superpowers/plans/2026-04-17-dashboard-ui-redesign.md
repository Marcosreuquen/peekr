# Dashboard UI Redesign & Log Decoupling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign peekr's web UI into a multi-panel dashboard with filtering, sorting, detail inspection, and live app logs; decouple child process output; add `peekr logs` CLI command.

**Architecture:** Backend changes add timing data to proxy records, pipe child stdout/stderr to log file + SSE, and add a new CLI subcommand. Frontend is a full rewrite of `ui/index.html` as a single self-contained file with CSS Grid layout, dark theme, and vanilla JS state management.

**Tech Stack:** Node.js >= 18, ESM, zero npm dependencies. All UI in one HTML file with inline CSS/JS.

---

### Task 1: Add timing data to proxy-core.mjs

**Files:**
- Modify: `lib/proxy-core.mjs:122-136` (forwardRequest section)
- Modify: `lib/proxy-core.mjs:101-115` (noForward section)

- [ ] **Step 1: Add timing capture around the forwarded request**

In `lib/proxy-core.mjs`, wrap the forward request with timing. Replace the block starting at line 123:

```javascript
      const startTime = Date.now();
      const forwardReq = transport.request(
        { hostname: upstreamHost, port: upstreamPort, path: upstreamPath, method: req.method, headers: forwardHeaders },
        forwardRes => {
          const fwdChunks = [];
          forwardRes.on('data', chunk => fwdChunks.push(chunk));
          forwardRes.on('end', () => {
            const durationMs = Date.now() - startTime;
            const forwardBody = Buffer.concat(fwdChunks).toString();
            const responseSize = Buffer.byteLength(forwardBody);
            if (!filtered) logResponse({ statusCode: forwardRes.statusCode, body: forwardBody });
            res.writeHead(forwardRes.statusCode, forwardRes.headers);
            res.end(forwardBody);
            if (onRequest && !filtered) onRequest({
              id, method: req.method, url: upstreamPath, host: upstreamHost, timestamp,
              reqHeaders: cleanReqHeaders, reqBody: body,
              statusCode: forwardRes.statusCode, resHeaders: forwardRes.headers, resBody: forwardBody,
              durationMs, responseSize, direction: 'OUT'
            });
          });
        }
      );
```

- [ ] **Step 2: Add timing and response fields to noForward path**

In the `noForward` block (~line 101-115), update the `onRequest` call:

```javascript
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
        const mockStr = JSON.stringify(mockResponse);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(mockStr);
        if (onRequest) onRequest({
          id, method: req.method, url: upstreamPath, host: destHost, timestamp,
          reqHeaders: cleanReqHeaders, reqBody: body,
          statusCode: 200, resHeaders: { 'content-type': 'application/json' }, resBody: mockStr,
          durationMs: 0, responseSize: Buffer.byteLength(mockStr), direction: 'OUT'
        });
        return;
      }
```

- [ ] **Step 3: Verify manually**

Run: `node bin/peekr.mjs run --no-forward -- node -e "fetch('http://example.com').then(r=>r.text()).then(console.log)"`

Expected: peekr starts, intercepts the request, mock 200 returned. No crashes.

- [ ] **Step 4: Commit**

```bash
git add lib/proxy-core.mjs
git commit -m "feat: add timing data and response headers to proxy request records"
```

---

### Task 2: Decouple child process logs in child-runner.mjs

**Files:**
- Modify: `lib/child-runner.mjs`

- [ ] **Step 1: Change stdio and add log piping**

Replace the entire content of `lib/child-runner.mjs`:

```javascript
// lib/child-runner.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { INTERCEPT_TEMPLATE } from './intercept-template.mjs';

const LOG_DIR = join(process.cwd(), '.peekr');
const LOG_FILE = join(LOG_DIR, 'app.log');
const MAX_BUFFER_LINES = 1000;

/** @type {Array<{stream: string, text: string, timestamp: number}>} */
const logBuffer = [];

/** @type {Set<(entry: object) => void>} */
const logListeners = new Set();

/**
 * Get the path to the app log file.
 * @returns {string}
 */
export function getLogFilePath() {
  return LOG_FILE;
}

/**
 * Get the current buffered log lines.
 * @returns {Array<{stream: string, text: string, timestamp: number}>}
 */
export function getLogBuffer() {
  return logBuffer;
}

/**
 * Register a listener for new log entries.
 * @param {(entry: {stream: string, text: string, timestamp: number}) => void} fn
 * @returns {() => void} unsubscribe function
 */
export function onLogEntry(fn) {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
}

function pushLogEntry(stream, text) {
  const entry = { stream, text, timestamp: Date.now() };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER_LINES) logBuffer.shift();
  for (const fn of logListeners) {
    try { fn(entry); } catch {}
  }
}

/**
 * Write the intercept loader to /tmp, spawn the child process with it injected,
 * and clean up on exit.
 *
 * @param {string[]} argv - command + args (e.g. ['npm', 'run', 'dev'])
 * @param {number} proxyPort
 * @returns {import('node:child_process').ChildProcess}
 */
export function spawnWithIntercept(argv, proxyPort) {
  const tmpFile = `/tmp/peekr-intercept-${process.pid}.mjs`;
  const loader = INTERCEPT_TEMPLATE.replace('__PROXY_PORT__', String(proxyPort));
  writeFileSync(tmpFile, loader, 'utf8');

  // Ensure .peekr directory and truncate log file
  mkdirSync(LOG_DIR, { recursive: true });
  const logStream = createWriteStream(LOG_FILE, { flags: 'w' });

  const existingNodeOptions = process.env.NODE_OPTIONS || '';
  const nodeOptions = `${existingNodeOptions} --import ${tmpFile}`.trim();

  const [cmd, ...args] = argv;
  const child = spawn(cmd, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    },
  });

  // Pipe stdout
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    logStream.write(text);
    // Split into lines but send as one entry per data event for performance
    pushLogEntry('stdout', text);
  });

  // Pipe stderr
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    logStream.write(text);
    pushLogEntry('stderr', text);
  });

  function cleanup() {
    logStream.end();
    try { unlinkSync(tmpFile); } catch {}
  }

  child.on('exit', cleanup);
  child.on('error', (err) => {
    console.error(`[peekr] Failed to start child process: ${err.message}`);
    cleanup();
  });
  process.once('SIGINT', () => { child.kill('SIGINT'); cleanup(); process.exit(0); });
  process.once('SIGTERM', () => { child.kill('SIGTERM'); cleanup(); process.exit(0); });

  return child;
}
```

- [ ] **Step 2: Verify manually**

Run: `node bin/peekr.mjs run --no-forward -- node -e "console.log('hello stdout'); console.error('hello stderr')"`

Expected: Terminal shows peekr's own output only (no "hello stdout/stderr"). File `.peekr/app.log` contains both lines.

- [ ] **Step 3: Commit**

```bash
git add lib/child-runner.mjs
git commit -m "feat: decouple child process logs - pipe to file and SSE buffer"
```

---

### Task 3: Update ui-server.mjs for app-log SSE events

**Files:**
- Modify: `lib/ui-server.mjs`

- [ ] **Step 1: Rewrite ui-server.mjs with log event support**

Replace the entire content of `lib/ui-server.mjs`:

```javascript
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
 * @param {number} [opts.port] - port to listen on (default 49997)
 * @param {function} [opts.getLogBuffer] - returns array of buffered log entries
 * @param {function} [opts.onLogSubscribe] - (callback) => unsubscribe; subscribes to new log entries
 * @returns {Promise<{ server: http.Server, broadcast: (record: object) => void, port: number }>}
 */
export function createUiServer(opts = {}) {
  const { port = 49997, getLogBuffer, onLogSubscribe } = opts;
  const clients = new Set();
  /** @type {Array<object>} */
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

      // Subscribe to new log entries
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
    // Serve dashboard for all other routes
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/ui-server.mjs
git commit -m "feat: add named SSE events (request, app-log) with buffered replay"
```

---

### Task 4: Wire log integration in ui-command.mjs and run-command.mjs

**Files:**
- Modify: `lib/ui-command.mjs`
- Modify: `lib/run-command.mjs`

- [ ] **Step 1: Update ui-command.mjs to pass log hooks to ui-server**

Replace the entire content of `lib/ui-command.mjs`:

```javascript
// lib/ui-command.mjs
import { createProxyServer } from './proxy-core.mjs';
import { createReverseProxy } from './reverse-proxy.mjs';
import { createUiServer } from './ui-server.mjs';
import { spawnWithIntercept, getLogBuffer, onLogEntry } from './child-runner.mjs';
import { c, setLogFile } from './logger.mjs';
import { getArg, getAllArgs, hasFlag } from './args.mjs';

export async function uiCommand(argv) {
  const sepIdx = argv.indexOf('--');
  const opts = sepIdx !== -1 ? argv.slice(0, sepIdx) : argv;
  const cmd  = sepIdx !== -1 ? argv.slice(sepIdx + 1) : null;

  const appPort     = parseInt(getArg(opts, 'app-port')     || '3000', 10);
  const port        = parseInt(getArg(opts, 'port')         || '49999', 10);
  const reversePort = parseInt(getArg(opts, 'reverse-port') || '49998', 10);
  const uiPort      = parseInt(getArg(opts, 'ui-port')      || '49997', 10);
  const target      = getArg(opts, 'target');
  const noForward   = hasFlag(opts, 'no-forward');
  const noHeaders   = hasFlag(opts, 'no-headers');
  const mockBody    = getArg(opts, 'mock');
  const logFile     = getArg(opts, 'log-file');
  const ignore      = getAllArgs(opts, 'ignore');

  if (logFile) setLogFile(logFile);

  // Only pass log hooks if we'll spawn a child
  const willSpawn = cmd && cmd.length > 0;
  const uiOpts = { port: uiPort };
  if (willSpawn) {
    uiOpts.getLogBuffer = () => getLogBuffer();
    uiOpts.onLogSubscribe = (fn) => onLogEntry(fn);
  }

  const { broadcast, port: actualUiPort } = await createUiServer(uiOpts);
  const onRequest = record => broadcast(record);

  const { port: actualProxyPort }   = await createProxyServer({ port, target, noForward, noHeaders, mockBody, onRequest, ignore });
  const { port: actualReversePort } = await createReverseProxy({ port: reversePort, appPort, noHeaders, onRequest });

  console.log(`\n${c('bold', 'peekr ui')} — HTTP Capture Dashboard`);
  console.log(c('dim', '─'.repeat(40)));
  console.log(`Dashboard     ${c('cyan', `http://localhost:${actualUiPort}`)}`);
  console.log(`Reverse proxy ${c('cyan', `http://localhost:${actualReversePort}`)} → app :${appPort}`);
  console.log(`Outgoing proxy${c('cyan', ` http://localhost:${actualProxyPort}`)}`);
  console.log(`Intercepting  ${target ? c('green', target) : c('yellow', 'all hosts')}`);
  if (noForward) console.log(`Mode          ${c('yellow', 'CAPTURE ONLY')}`);
  console.log(c('dim', '─'.repeat(40)));
  console.log('');
  console.log(c('bold', 'How to capture traffic:'));
  console.log('');
  if (willSpawn) {
    console.log(`  ${c('green', '✔')} Outgoing (OUT): automatic — app was started by peekr`);
  } else {
    console.log(`  ${c('yellow', '!')} Outgoing (OUT): not captured`);
    console.log(`    To capture outgoing calls, start your app through peekr:`);
    console.log(`    ${c('dim', `peekr ui --app-port ${appPort} -- <your start command>`)}`);
  }
  console.log(`  ${c('yellow', '!')} Incoming (IN):  send requests to the reverse proxy, not your app directly:`);
  console.log(`    ${c('cyan', `http://localhost:${actualReversePort}`)} ${c('dim', `→ forwards to your app on :${appPort}`)}`);
  console.log('');
  console.log(c('dim', '─'.repeat(40)) + '\n');

  if (willSpawn) {
    const child = spawnWithIntercept(cmd, actualProxyPort);
    child.on('exit', code => process.exit(code ?? 0));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ui-command.mjs
git commit -m "feat: wire child process log streaming to UI server SSE"
```

---

### Task 5: Create `peekr logs` command

**Files:**
- Create: `lib/logs-command.mjs`
- Modify: `bin/peekr.mjs`

- [ ] **Step 1: Create lib/logs-command.mjs**

```javascript
// lib/logs-command.mjs
import { createReadStream, statSync } from 'node:fs';
import { truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOG_FILE = join(process.cwd(), '.peekr', 'app.log');

export function logsCommand(argv) {
  const hasClear = argv.includes('--clear');

  if (hasClear) {
    try {
      truncateSync(LOG_FILE, 0);
      console.log('Log file cleared.');
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log('No log file found.');
      } else {
        console.error(`Error clearing log file: ${err.message}`);
      }
    }
    process.exit(0);
  }

  let offset = 0;
  try {
    const stat = statSync(LOG_FILE);
    // Start from beginning to show existing content
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No log file found. Start your app with `peekr run` or `peekr ui` first.');
      console.log(`Expected: ${LOG_FILE}`);
      process.exit(1);
    }
    throw err;
  }

  console.log(`Following ${LOG_FILE} (Ctrl+C to stop)\n`);

  function poll() {
    try {
      const stat = statSync(LOG_FILE);
      if (stat.size > offset) {
        const stream = createReadStream(LOG_FILE, { start: offset, encoding: 'utf8' });
        stream.on('data', (chunk) => process.stdout.write(chunk));
        stream.on('end', () => { offset = stat.size; });
      }
    } catch {}
  }

  poll(); // Initial read
  const interval = setInterval(poll, 200);

  process.on('SIGINT', () => {
    clearInterval(interval);
    process.exit(0);
  });
}
```

- [ ] **Step 2: Add `logs` subcommand to bin/peekr.mjs**

In `bin/peekr.mjs`, add after the `} else if (subcommand === 'ui') {` block closes (before the final `} else {`), insert:

```javascript
} else if (subcommand === 'logs') {
  const args = process.argv.slice(3);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`
peekr logs — Follow app logs from peekr-managed child processes

Usage:
  peekr logs [options]

Options:
  --clear   Clear the log file and exit
  -h, --help Show this help

The log file is located at .peekr/app.log in the current directory.
`);
    process.exit(0);
  }
  const { logsCommand } = await import('../lib/logs-command.mjs');
  logsCommand(args);
```

- [ ] **Step 3: Update the main help text**

In the main help block in `bin/peekr.mjs`, add `logs` to the subcommands list. In the help string, after the `ui` description, add:

```
  logs  Follow app logs from peekr-managed child processes.
        Run: peekr logs --help
```

- [ ] **Step 4: Commit**

```bash
git add lib/logs-command.mjs bin/peekr.mjs
git commit -m "feat: add peekr logs command for following child process output"
```

---

### Task 6: Rewrite ui/index.html — Dashboard UI

**Files:**
- Modify: `ui/index.html`

This is the largest task. The file is a complete rewrite — a single self-contained HTML file with inline CSS and JS.

- [ ] **Step 1: Write the complete new ui/index.html**

The file structure:
1. `<style>` — CSS Grid layout, dark theme, all component styles
2. `<body>` — HTML structure for top bar, table, detail drawer, log drawer
3. `<script>` — state management, SSE connection, rendering functions, event handlers

Key implementation details:

**CSS Grid layout:**
```css
body {
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-columns: 1fr auto;
  height: 100vh;
}
.top-bar { grid-column: 1 / -1; }
.request-table-wrap { grid-column: 1; grid-row: 2; overflow: auto; }
.detail-drawer { grid-column: 2; grid-row: 2; width: 0; transition: width 0.2s; }
.detail-drawer.open { width: 420px; }
.log-drawer { grid-column: 1 / -1; grid-row: 3; }
```

**State object:**
```javascript
const state = {
  requests: [],
  filters: { method: '', status: '', host: '', search: '' },
  sortBy: 'id', sortDir: 'desc',
  selectedId: null,
  logLines: [],
  logDrawerState: 'collapsed', // 'collapsed' | 'medium' | 'expanded'
  logFilter: 'raw', // 'raw' | 'info' | 'warn' | 'error'
};
```

**SSE connection with named events:**
```javascript
const es = new EventSource('/events');
es.addEventListener('request', (e) => { /* parse, push to state.requests, render */ });
es.addEventListener('app-log', (e) => { /* parse, push to state.logLines (cap 5000), render */ });
```

**JSON syntax highlighting (CSS-only, regex tokenization):**
```javascript
function highlightJson(str) {
  try {
    const formatted = JSON.stringify(JSON.parse(str), null, 2);
    return formatted
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"([^"]+)"(?=\s*:)/g, '<span class="json-key">"$1"</span>')
      .replace(/:\s*"([^"]*)"/g, ': <span class="json-str">"$1"</span>')
      .replace(/:\s*(\d+\.?\d*)/g, ': <span class="json-num">$1</span>')
      .replace(/:\s*(true|false)/g, ': <span class="json-bool">$1</span>')
      .replace(/:\s*(null)/g, ': <span class="json-null">$1</span>');
  } catch { return escHtml(str); }
}
```

**Render throttling:**
```javascript
let renderPending = false;
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => { renderPending = false; renderTable(); });
}
```

**Table sort:** click on `<th>` toggles `state.sortBy`/`state.sortDir`, calls `scheduleRender()`.

**Filters:** change events on `<select>` and input event on search update `state.filters`, call `scheduleRender()`.

**Detail drawer:** click on table row sets `state.selectedId`, calls `renderDetail()`, adds `.open` to drawer.

**Log drawer toggle:** click on title bar cycles `state.logDrawerState` through collapsed→medium→expanded→collapsed.

**Log filtering:** regex patterns for common formats:
```javascript
const LOG_PATTERNS = {
  info:  /\b(INFO|info)\b/,
  warn:  /\b(WARN|warn|WARNING|warning)\b/,
  error: /\b(ERROR|error|ERR)\b/,
};
```

The full HTML file will be approximately 900-1100 lines.

- [ ] **Step 2: Verify manually**

Run: `node bin/peekr.mjs ui --app-port 3000 -- node -e "const http=require('http');http.createServer((q,s)=>{s.end('ok')}).listen(3000,()=>{console.log('listening');console.error('warn test');fetch('http://jsonplaceholder.typicode.com/todos/1').then(r=>r.json()).then(d=>console.log(JSON.stringify(d)))})"`

Open browser at the dashboard URL. Verify:
- Top bar with filters visible
- Request appears in table
- Click row opens detail drawer with tabs
- Bottom drawer shows "listening" and "warn test" log lines
- Filters work
- Sort works

- [ ] **Step 3: Commit**

```bash
git add ui/index.html
git commit -m "feat: rewrite dashboard UI with multi-panel layout, filtering, and app logs"
```

---

### Task 7: Integration test — full flow

- [ ] **Step 1: End-to-end manual verification**

Run the full stack:
```bash
node bin/peekr.mjs ui --app-port 3000 -- node -e "
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify({hello:'world'}));
}).listen(3000, () => {
  console.log('App started on :3000');
  setTimeout(() => fetch('http://httpbin.org/get').then(r=>r.json()).then(d=>console.log(JSON.stringify(d))), 1000);
});
"
```

Verify checklist:
- [ ] Dashboard loads at the UI port
- [ ] Outgoing request appears in table with timing data
- [ ] Click row opens detail drawer, tabs work (Headers/Payload/Response)
- [ ] JSON bodies are syntax-highlighted
- [ ] Status code colors correct (green for 2xx)
- [ ] Filters (method/status/host/search) narrow the table
- [ ] Sort by clicking column headers works
- [ ] App logs show in bottom drawer ("App started on :3000")
- [ ] Log drawer cycles through 3 states on click
- [ ] Clear button clears the request list
- [ ] Counter shows correct counts

In a second terminal:
```bash
node bin/peekr.mjs logs
```
Verify: shows the same log output as the bottom drawer.

- [ ] **Step 2: Test peekr logs --clear**

```bash
node bin/peekr.mjs logs --clear
cat .peekr/app.log  # should be empty
```

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration fixes from full-flow testing"
```
