# peekr run & ui modes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `peekr run` (CLI wrapper with full outgoing HTTP interception) and `peekr ui` (web dashboard with reverse proxy) as subcommands to the existing peekr CLI.

**Architecture:** Extract shared proxy logic from `bin/peekr.mjs` into `lib/`, build `peekr run` on top of a monkey-patch injection mechanism, then build `peekr ui` on top of `peekr run` adding a reverse proxy and SSE-based dashboard. The entry point dispatches subcommands; all modes share `proxy-core.mjs` and `logger.mjs`.

**Tech Stack:** Node.js >= 18, ESM, zero npm dependencies, `node:http`, `node:https`, `node:child_process`, `node:fs`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `bin/peekr.mjs` | Modify | Add subcommand dispatch; delegate to lib modules |
| `lib/logger.mjs` | Create | Log formatting extracted from current peekr.mjs |
| `lib/proxy-core.mjs` | Create | HTTP proxy server; multi-target routing; onRequest callback |
| `lib/intercept-template.mjs` | Create | ESM loader template that monkey-patches node:http/https |
| `lib/child-runner.mjs` | Create | Spawn child process with injected NODE_OPTIONS + cleanup |
| `lib/reverse-proxy.mjs` | Create | HTTP reverse proxy that sits in front of the user's app |
| `lib/ui-server.mjs` | Create | Serves dashboard HTML + SSE /events endpoint |
| `ui/index.html` | Create | Dashboard SPA: SSE listener + request card rendering |

---

## Task 1: Extract `logger.mjs`

**Files:**
- Create: `lib/logger.mjs`
- Modify: `bin/peekr.mjs`

- [ ] **Step 1: Create `lib/logger.mjs`**

```js
// lib/logger.mjs
export const COLORS = {
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
  cyan:  '\x1b[36m',
  yellow:'\x1b[33m',
  green: '\x1b[32m',
  red:   '\x1b[31m',
  bold:  '\x1b[1m',
};

export const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;
export const DIVIDER = '='.repeat(80);

export function prettyBody(raw) {
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch { return raw; }
}

export function logSection(label, content, color = 'dim') {
  console.log(c('dim', `\n--- ${label} ---`));
  console.log(c(color, content));
}

export function logRequest({ id, method, url, host, timestamp, headers, body, noHeaders }) {
  console.log('\n' + DIVIDER);
  console.log(
    c('bold', `[#${id}]`) +
    c('dim', ` ${timestamp}`) +
    '  ' +
    c('cyan', `${method} ${host}${url}`)
  );
  console.log(DIVIDER);
  if (!noHeaders) logSection('Headers', JSON.stringify(headers, null, 2));
  if (body) logSection('Payload', prettyBody(body), 'yellow');
}

export function logResponse({ id, statusCode, body }) {
  const color = statusCode < 400 ? 'green' : 'red';
  logSection(`Response ${statusCode}`, prettyBody(body), color);
  console.log(DIVIDER + '\n');
}
```

- [ ] **Step 2: Update `bin/peekr.mjs` to import from `lib/logger.mjs`**

Replace the inline color/logging definitions in `bin/peekr.mjs`:

```js
import { c, DIVIDER, prettyBody, logSection, logRequest, logResponse, COLORS } from '../lib/logger.mjs';
```

Remove the `COLORS`, `c`, `DIVIDER`, `prettyBody`, `logSection` definitions from `bin/peekr.mjs`. Update the two call sites that log requests and responses to use `logRequest()` and `logResponse()` with the new signature.

The `logRequest` call site (around line 102 in the original):
```js
logRequest({
  id,
  method: req.method,
  url: req.url,
  host: TARGET_HOST || '',
  timestamp,
  headers: req.headers,
  body,
  noHeaders: NO_HEADERS,
});
```

The `logResponse` call site (inside the forward response handler):
```js
logResponse({ id, statusCode: forwardRes.statusCode, body: forwardBody });
```

- [ ] **Step 3: Run a quick smoke test**

```bash
node bin/peekr.mjs --no-forward &
curl -s http://localhost:9999/test
kill %1
```

Expected: peekr starts, logs the request with headers+payload format, returns `{}`.

- [ ] **Step 4: Commit**

```bash
git add lib/logger.mjs bin/peekr.mjs
git commit -m "refactor: extract logger into lib/logger.mjs"
```

---

## Task 2: Create `lib/proxy-core.mjs`

**Files:**
- Create: `lib/proxy-core.mjs`
- Modify: `bin/peekr.mjs` (use proxy-core instead of inline server)

- [ ] **Step 1: Create `lib/proxy-core.mjs`**

```js
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
      // Destination host: from proxy absolute URL or Host header
      const destHost = req.headers['x-peekr-dest'] || req.headers['host'] || target || '';
      const filtered = target && destHost !== target;

      if (!filtered) {
        logRequest({ id, method: req.method, url: req.url, host: destHost, timestamp, headers: req.headers, body, noHeaders });
      }

      if (noForward) {
        let mockResponse = {};
        if (mockBody) {
          try { mockResponse = JSON.parse(mockBody); }
          catch { console.error(c('red', `[#${id}] --mock is not valid JSON, using {}`)); }
        }
        if (!filtered) console.log(c('dim', `\n[#${id}] --no-forward: returning mock 200`));
        console.log('='.repeat(80) + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockResponse));
        if (onRequest) onRequest({ id, method: req.method, url: req.url, host: destHost, timestamp, reqHeaders: req.headers, reqBody: body, statusCode: 200, resBody: JSON.stringify(mockResponse), direction: 'OUT' });
        return;
      }

      const upstreamHost = target || destHost;
      const forwardReq = https.request(
        { hostname: upstreamHost, port: 443, path: req.url, method: req.method, headers: { ...req.headers, host: upstreamHost } },
        forwardRes => {
          const fwdChunks = [];
          forwardRes.on('data', c => fwdChunks.push(c));
          forwardRes.on('end', () => {
            const forwardBody = Buffer.concat(fwdChunks).toString();
            if (!filtered) logResponse({ id, statusCode: forwardRes.statusCode, body: forwardBody });
            res.writeHead(forwardRes.statusCode, forwardRes.headers);
            res.end(forwardBody);
            if (onRequest && !filtered) onRequest({ id, method: req.method, url: req.url, host: upstreamHost, timestamp, reqHeaders: req.headers, reqBody: body, statusCode: forwardRes.statusCode, resBody: forwardBody, direction: 'OUT' });
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
```

- [ ] **Step 2: Update `bin/peekr.mjs` to use `createProxyServer`**

Replace the inline `http.createServer(...)` + `server.listen(...)` block with:

```js
import { createProxyServer } from '../lib/proxy-core.mjs';

// ... (keep arg parsing as-is) ...

const server = await createProxyServer({
  port: PORT,
  target: TARGET_HOST,
  noForward: NO_FORWARD,
  noHeaders: NO_HEADERS,
  mockBody: MOCK_BODY,
});

console.log(`\n${c('bold', 'peekr')} — HTTP Capture Proxy`);
console.log(c('dim', '─'.repeat(40)));
console.log(`Listening on  ${c('cyan', `http://localhost:${PORT}`)}`);
if (NO_FORWARD) {
  console.log(`Mode          ${c('yellow', 'CAPTURE ONLY')} (no forwarding)`);
} else {
  console.log(`Forwarding to ${c('green', `https://${TARGET_HOST}`)}`);
}
if (NO_HEADERS) console.log(`Headers       ${c('dim', 'hidden (--no-headers)')}`);
console.log(c('dim', '─'.repeat(40)));
console.log('Waiting for requests...\n');
```

Because `createProxyServer` returns a Promise, wrap the top-level code in an async IIFE or add `await` at top level (ESM supports top-level await).

- [ ] **Step 3: Smoke test**

```bash
node bin/peekr.mjs --no-forward &
curl -s http://localhost:9999/ping
kill %1
```

Expected: same output as before — request logged, `{}` returned.

- [ ] **Step 4: Commit**

```bash
git add lib/proxy-core.mjs bin/peekr.mjs
git commit -m "refactor: extract proxy server into lib/proxy-core.mjs"
```

---

## Task 3: Create `lib/intercept-template.mjs` and `lib/child-runner.mjs`

**Files:**
- Create: `lib/intercept-template.mjs`
- Create: `lib/child-runner.mjs`

- [ ] **Step 1: Create `lib/intercept-template.mjs`**

This file is a template — it will be written to `/tmp` and loaded by the child process via `--import`. The `__PROXY_PORT__` token is replaced at write time.

```js
// lib/intercept-template.mjs
// This file is a template. __PROXY_PORT__ is replaced before writing to /tmp.
export const INTERCEPT_TEMPLATE = `
import http from 'node:http';
import https from 'node:https';

const PROXY_PORT = __PROXY_PORT__;
const PROXY_HOST = '127.0.0.1';

function patchModule(mod) {
  const original = mod.request.bind(mod);
  mod.request = function patchedRequest(options, callback) {
    // Normalize options to object form
    if (typeof options === 'string' || options instanceof URL) {
      options = Object.assign({}, new URL(options.toString()));
    } else {
      options = Object.assign({}, options);
    }

    const destHost = options.hostname || options.host || 'localhost';
    const destPort = options.port || (mod === https ? 443 : 80);
    const destPath = options.path || '/';
    const destProto = mod === https ? 'https' : 'http';

    // Redirect to local peekr proxy
    options.hostname = PROXY_HOST;
    options.host = PROXY_HOST;
    options.port = PROXY_PORT;
    // Encode original destination in a custom header
    options.headers = options.headers || {};
    options.headers['x-peekr-dest'] = destHost;
    options.headers['x-peekr-dest-port'] = String(destPort);
    options.headers['x-peekr-dest-proto'] = destProto;
    // Make path absolute so proxy knows where to forward
    if (!options.path || !options.path.startsWith('http')) {
      options.path = destProto + '://' + destHost + ':' + destPort + destPath;
    }
    // Use plain http to talk to local proxy
    return http.ClientRequest ? new http.ClientRequest(options, callback) : original(options, callback);
  };
}

patchModule(http);
patchModule(https);
`;
```

- [ ] **Step 2: Create `lib/child-runner.mjs`**

```js
// lib/child-runner.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { INTERCEPT_TEMPLATE } from './intercept-template.mjs';

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

  const existingNodeOptions = process.env.NODE_OPTIONS || '';
  const nodeOptions = `${existingNodeOptions} --import ${tmpFile}`.trim();

  const [cmd, ...args] = argv;
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
      HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    },
  });

  function cleanup() {
    try { unlinkSync(tmpFile); } catch {}
  }

  child.on('exit', cleanup);
  process.on('SIGINT', () => { child.kill('SIGINT'); cleanup(); });
  process.on('SIGTERM', () => { child.kill('SIGTERM'); cleanup(); });

  return child;
}
```

- [ ] **Step 3: Manual integration test**

Create a tiny test app in `/tmp/test-app.mjs`:

```js
// /tmp/test-app.mjs
import https from 'node:https';
https.get('https://httpbin.org/get', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => { console.log('APP GOT:', res.statusCode); process.exit(0); });
});
```

Then run:

```bash
node -e "
import('./lib/proxy-core.mjs').then(({ createProxyServer }) =>
  createProxyServer({ port: 9999 }).then(() => {
    import('./lib/child-runner.mjs').then(({ spawnWithIntercept }) => {
      spawnWithIntercept(['node', '/tmp/test-app.mjs'], 9999);
    });
  })
);
" --input-type=module
```

Expected: peekr logs the outgoing GET request to httpbin.org, child prints `APP GOT: 200`.

- [ ] **Step 4: Commit**

```bash
git add lib/intercept-template.mjs lib/child-runner.mjs
git commit -m "feat: add intercept template and child runner for peekr run"
```

---

## Task 4: Add `peekr run` subcommand to `bin/peekr.mjs`

**Files:**
- Modify: `bin/peekr.mjs`

- [ ] **Step 1: Add subcommand dispatch at top of `bin/peekr.mjs`**

Insert after the shebang and before any other logic:

```js
const subcommand = process.argv[2];

if (subcommand === 'run') {
  const { runCommand } = await import('../lib/run-command.mjs');
  await runCommand(process.argv.slice(3));
  process.exit(0);
}

if (subcommand === 'ui') {
  const { uiCommand } = await import('../lib/ui-command.mjs');
  await uiCommand(process.argv.slice(3));
  process.exit(0);
}
// else fall through to existing proxy mode (backward compat)
```

- [ ] **Step 2: Create `lib/run-command.mjs`**

```js
// lib/run-command.mjs
import { createProxyServer } from './proxy-core.mjs';
import { spawnWithIntercept } from './child-runner.mjs';
import { c } from './logger.mjs';

function getArg(args, name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
const hasFlag = (args, name) => args.includes(`--${name}`);

export async function runCommand(argv) {
  // Split on '--' separator
  const sepIdx = argv.indexOf('--');
  if (sepIdx === -1) {
    console.error(c('red', '\nError: peekr run requires a command after --'));
    console.error('Usage: peekr run [options] -- <command>\n');
    process.exit(1);
  }

  const opts = argv.slice(0, sepIdx);
  const cmd = argv.slice(sepIdx + 1);

  const target    = getArg(opts, 'target');
  const port      = parseInt(getArg(opts, 'port') || '9999', 10);
  const noForward = hasFlag(opts, 'no-forward');
  const noHeaders = hasFlag(opts, 'no-headers');
  const mockBody  = getArg(opts, 'mock');

  const server = await createProxyServer({ port, target, noForward, noHeaders, mockBody });

  console.log(`\n${c('bold', 'peekr run')} — HTTP Capture Proxy`);
  console.log(c('dim', '─'.repeat(40)));
  console.log(`Proxy on      ${c('cyan', `http://localhost:${port}`)}`);
  console.log(`Intercepting  ${target ? c('green', target) : c('yellow', 'all hosts')}`);
  if (noForward) console.log(`Mode          ${c('yellow', 'CAPTURE ONLY')} (no forwarding)`);
  console.log(`Command       ${c('dim', cmd.join(' '))}`);
  console.log(c('dim', '─'.repeat(40)) + '\n');

  const child = spawnWithIntercept(cmd, port);

  child.on('exit', code => {
    server.close();
    process.exit(code ?? 0);
  });
}
```

- [ ] **Step 3: Test `peekr run`**

```bash
node bin/peekr.mjs run --no-forward -- node -e "
import https from 'node:https';
https.get('https://example.com/', res => { console.log('status', res.statusCode); process.exit(0); });
" --input-type=module
```

Expected: peekr logs the request to `example.com`, the child prints `status 200` (or proxy mock 200 if `--no-forward`).

- [ ] **Step 4: Commit**

```bash
git add bin/peekr.mjs lib/run-command.mjs
git commit -m "feat: add peekr run subcommand"
```

---

## Task 5: Create `lib/reverse-proxy.mjs`

**Files:**
- Create: `lib/reverse-proxy.mjs`

- [ ] **Step 1: Create `lib/reverse-proxy.mjs`**

```js
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
          fwdRes.on('data', c => fwdChunks.push(c));
          fwdRes.on('end', () => {
            const fwdBody = Buffer.concat(fwdChunks).toString();
            logResponse({ id, statusCode: fwdRes.statusCode, body: fwdBody });
            res.writeHead(fwdRes.statusCode, fwdRes.headers);
            res.end(fwdBody);
            if (onRequest) onRequest({
              id, direction: 'IN',
              method: req.method, url: req.url, host: req.headers['host'] || '',
              timestamp, reqHeaders: req.headers, reqBody: body,
              statusCode: fwdRes.statusCode, resBody: fwdBody,
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
```

- [ ] **Step 2: Smoke test**

Start a minimal echo server on port 3000, then the reverse proxy on 8888, and send a request:

```bash
node -e "
import http from 'node:http';
http.createServer((req,res) => res.end('hello from app')).listen(3000);
" --input-type=module &

node -e "
import { createReverseProxy } from './lib/reverse-proxy.mjs';
createReverseProxy({ port: 8888, appPort: 3000 });
" --input-type=module &

curl -s http://localhost:8888/test
kill %1 %2
```

Expected: peekr logs the incoming request, curl receives `hello from app`.

- [ ] **Step 3: Commit**

```bash
git add lib/reverse-proxy.mjs
git commit -m "feat: add reverse proxy for incoming request capture"
```

---

## Task 6: Create `lib/ui-server.mjs` and `ui/index.html`

**Files:**
- Create: `lib/ui-server.mjs`
- Create: `ui/index.html`

- [ ] **Step 1: Create `ui/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>peekr dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: monospace; background: #0d1117; color: #c9d1d9; padding: 1rem; }
  h1 { color: #58a6ff; margin-bottom: 1rem; font-size: 1.2rem; }
  #status { color: #3fb950; font-size: 0.8rem; margin-bottom: 1rem; }
  #log { display: flex; flex-direction: column; gap: 0.5rem; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
  .card-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem; cursor: pointer; user-select: none; }
  .direction { font-size: 0.7rem; padding: 2px 6px; border-radius: 3px; font-weight: bold; }
  .direction.IN  { background: #1f6feb; color: #fff; }
  .direction.OUT { background: #388bfd22; color: #58a6ff; border: 1px solid #388bfd; }
  .method { font-weight: bold; color: #d2a8ff; min-width: 50px; }
  .host { color: #79c0ff; }
  .path { color: #c9d1d9; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { font-weight: bold; }
  .status.ok  { color: #3fb950; }
  .status.err { color: #f85149; }
  .ts { color: #6e7681; font-size: 0.75rem; margin-left: auto; white-space: nowrap; }
  .card-body { padding: 0.75rem; border-top: 1px solid #30363d; display: none; }
  .card-body.open { display: block; }
  .card-body pre { white-space: pre-wrap; word-break: break-all; font-size: 0.8rem; color: #e6edf3; }
  .label { color: #6e7681; font-size: 0.75rem; margin-top: 0.5rem; margin-bottom: 0.25rem; }
</style>
</head>
<body>
<h1>peekr dashboard</h1>
<div id="status">connecting...</div>
<div id="log"></div>
<script>
  const log = document.getElementById('log');
  const status = document.getElementById('status');
  const es = new EventSource('/events');

  es.onopen = () => { status.textContent = 'connected'; status.style.color = '#3fb950'; };
  es.onerror = () => { status.textContent = 'disconnected'; status.style.color = '#f85149'; };

  es.onmessage = e => {
    const r = JSON.parse(e.data);
    const card = document.createElement('div');
    card.className = 'card';

    const statusClass = r.statusCode < 400 ? 'ok' : 'err';
    card.innerHTML = `
      <div class="card-header">
        <span class="direction ${r.direction}">${r.direction}</span>
        <span class="method">${r.method}</span>
        <span class="host">${r.host}</span>
        <span class="path">${r.url}</span>
        <span class="status ${statusClass}">${r.statusCode}</span>
        <span class="ts">${new Date(r.timestamp).toLocaleTimeString()}</span>
      </div>
      <div class="card-body">
        <div class="label">Request Body</div>
        <pre>${escHtml(pretty(r.reqBody))}</pre>
        <div class="label">Response Body</div>
        <pre>${escHtml(pretty(r.resBody))}</pre>
      </div>`;

    card.querySelector('.card-header').addEventListener('click', () => {
      card.querySelector('.card-body').classList.toggle('open');
    });

    log.prepend(card);
  };

  function pretty(s) {
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s || ''; }
  }
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
</script>
</body>
</html>
```

- [ ] **Step 2: Create `lib/ui-server.mjs`**

```js
// lib/ui-server.mjs
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '../ui/index.html'), 'utf8');

/**
 * Serve the dashboard HTML and a /events SSE endpoint.
 *
 * @param {object} opts
 * @param {number} opts.port       - port to listen on (default 4000)
 * @returns {{ server: http.Server, broadcast: (record: object) => void }}
 */
export function createUiServer(opts = {}) {
  const { port = 4000 } = opts;
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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  });

  function broadcast(record) {
    const data = `data: ${JSON.stringify(record)}\n\n`;
    for (const client of clients) {
      try { client.write(data); } catch { clients.delete(client); }
    }
  }

  return new Promise(resolve =>
    server.listen(port, () => resolve({ server, broadcast }))
  );
}
```

- [ ] **Step 3: Smoke test**

```bash
node -e "
import { createUiServer } from './lib/ui-server.mjs';
const { broadcast } = await createUiServer({ port: 4000 });
setInterval(() => broadcast({ id: 1, direction: 'OUT', method: 'GET', host: 'example.com', url: '/test', statusCode: 200, timestamp: new Date().toISOString(), reqBody: '', resBody: '{\"ok\":true}' }), 2000);
" --input-type=module
```

Open `http://localhost:4000` in a browser. Expected: dashboard loads, a new card appears every 2 seconds.

- [ ] **Step 4: Commit**

```bash
git add lib/ui-server.mjs ui/index.html
git commit -m "feat: add UI server with SSE dashboard"
```

---

## Task 7: Add `peekr ui` subcommand

**Files:**
- Create: `lib/ui-command.mjs`
- Modify: `bin/peekr.mjs` (dispatch already added in Task 4 Step 1)

- [ ] **Step 1: Create `lib/ui-command.mjs`**

```js
// lib/ui-command.mjs
import { createProxyServer } from './proxy-core.mjs';
import { createReverseProxy } from './reverse-proxy.mjs';
import { createUiServer } from './ui-server.mjs';
import { spawnWithIntercept } from './child-runner.mjs';
import { c } from './logger.mjs';

function getArg(args, name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
const hasFlag = (args, name) => args.includes(`--${name}`);

export async function uiCommand(argv) {
  const sepIdx = argv.indexOf('--');
  const opts = sepIdx !== -1 ? argv.slice(0, sepIdx) : argv;
  const cmd  = sepIdx !== -1 ? argv.slice(sepIdx + 1) : null;

  const appPort     = parseInt(getArg(opts, 'app-port')     || '3000', 10);
  const port        = parseInt(getArg(opts, 'port')         || '9999', 10);
  const reversePort = parseInt(getArg(opts, 'reverse-port') || '8888', 10);
  const uiPort      = parseInt(getArg(opts, 'ui-port')      || '4000', 10);
  const target      = getArg(opts, 'target');
  const noForward   = hasFlag(opts, 'no-forward');
  const noHeaders   = hasFlag(opts, 'no-headers');
  const mockBody    = getArg(opts, 'mock');

  const { broadcast } = await createUiServer({ port: uiPort });
  const onRequest = record => broadcast(record);

  await createProxyServer({ port, target, noForward, noHeaders, mockBody, onRequest });
  await createReverseProxy({ port: reversePort, appPort, noHeaders, onRequest });

  console.log(`\n${c('bold', 'peekr ui')} — HTTP Capture Dashboard`);
  console.log(c('dim', '─'.repeat(40)));
  console.log(`Dashboard     ${c('cyan', `http://localhost:${uiPort}`)}`);
  console.log(`Reverse proxy ${c('cyan', `http://localhost:${reversePort}`)} → app :${appPort}`);
  console.log(`Outgoing proxy${c('cyan', ` http://localhost:${port}`)}`);
  console.log(`Intercepting  ${target ? c('green', target) : c('yellow', 'all hosts')}`);
  if (noForward) console.log(`Mode          ${c('yellow', 'CAPTURE ONLY')}`);
  console.log(c('dim', '─'.repeat(40)) + '\n');

  if (cmd && cmd.length > 0) {
    const child = spawnWithIntercept(cmd, port);
    child.on('exit', code => process.exit(code ?? 0));
  }
}
```

- [ ] **Step 2: Test `peekr ui` standalone (app already running)**

In one terminal, start a dummy app:

```bash
node -e "import http from 'node:http'; http.createServer((_,res) => res.end('hello')).listen(3000);" --input-type=module
```

In another, start peekr ui:

```bash
node bin/peekr.mjs ui --app-port 3000 --no-forward
```

Send a request through the reverse proxy:

```bash
curl -s http://localhost:8888/anything
```

Expected: dashboard at `http://localhost:4000` shows a new IN card for the request.

- [ ] **Step 3: Test `peekr ui` combined mode (peekr starts the app)**

```bash
node bin/peekr.mjs ui --app-port 3000 -- node -e "
import http from 'node:http';
import https from 'node:https';
http.createServer((_,res) => {
  https.get('https://httpbin.org/get', r => res.end('ok'));
}).listen(3000);
" --input-type=module
```

Send a request:

```bash
curl -s http://localhost:8888/
```

Expected: dashboard shows one IN card (incoming to the app) and one OUT card (outgoing to httpbin.org).

- [ ] **Step 4: Commit**

```bash
git add lib/ui-command.mjs
git commit -m "feat: add peekr ui subcommand with reverse proxy and live dashboard"
```

---

## Task 8: Update README and `package.json`

**Files:**
- Modify: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Update `package.json` files field**

Add `lib/` and `ui/` to the `files` array so they're included in npm publish:

```json
"files": [
  "bin/",
  "lib/",
  "ui/"
]
```

- [ ] **Step 2: Update README**

Add sections for `peekr run` and `peekr ui` after the existing Usage section. Key content:

- `peekr run` usage, flags table, example with NestJS dev script in package.json, known HTTP client compatibility note.
- `peekr ui` usage, ports table, traffic flow diagram, combined mode example.

- [ ] **Step 3: Commit**

```bash
git add README.md package.json
git commit -m "docs: update README and package.json for run and ui modes"
```

---

## Self-Review Notes

- Task 4 Step 1 adds dispatch to `bin/peekr.mjs` before `lib/run-command.mjs` exists — that's fine because the dispatch uses dynamic `import()` which only runs when the subcommand is invoked.
- The intercept template in Task 3 patches both `http` and `https` modules; the monkey-patch redirects to a plain HTTP local proxy (no TLS between child and peekr). This is intentional — `NODE_TLS_REJECT_UNAUTHORIZED=0` is set to avoid errors on the upstream side.
- `proxy-core.mjs` uses `x-peekr-dest` header written by the intercept template to know the real destination host. This header must be stripped before forwarding upstream (add `delete options.headers['x-peekr-dest']` in the forward request setup in `proxy-core.mjs`).
