# peekr — `run` & `ui` modes design spec

**Date:** 2026-04-16  
**Status:** Approved

---

## Problem

Using peekr currently requires manually editing `.env` files to redirect a service's base URL to `http://localhost:9999`, then reverting after debugging. This is error-prone, slow, and only works with apps that expose env vars for every upstream host.

---

## Goal

Two new modes that eliminate manual `.env` changes:

1. **`peekr run`** — CLI wrapper that spawns the user's app as a child process with all outgoing HTTP/HTTPS traffic automatically intercepted and logged.
2. **`peekr ui`** — Web UI mode that acts as a reverse proxy in front of the user's app and shows a live dashboard of all request/response activity.

Both modes support multi-target transparent proxying (capture all hosts) or single-target filtering (`--target`).

---

## Architecture

### File structure

```
bin/
  peekr.mjs              ← entry point; dispatches subcommands
lib/
  proxy-core.mjs         ← shared HTTP proxy server logic (logging + forwarding)
  logger.mjs             ← log formatting (extracted from current peekr.mjs)
  reverse-proxy.mjs      ← reverse proxy: sits in front of the user's app
  intercept-template.mjs ← monkey-patch template injected into child process
ui/
  index.html             ← dashboard SPA (served inline, no build step)
```

### Subcommand dispatch

```bash
peekr [proxy]   # existing mode (backward compatible)
peekr run       # new: CLI wrapper
peekr ui        # new: web UI
```

---

## `peekr run`

### Usage

```bash
peekr run [--target <host>] [--port <port>] [--no-forward] [--no-headers] -- <command>
```

### Behavior

1. peekr starts its proxy server on `--port` (default 9999).
2. Writes a temporary ESM loader file to `/tmp/peekr-intercept-<pid>.mjs` that monkey-patches `node:http` and `node:https` to route all outgoing requests through the local proxy.
3. Spawns the child process with:
   - `NODE_OPTIONS=--import /tmp/peekr-intercept-<pid>.mjs` injected into the child's environment (merged with the current `process.env`).
   - `HTTP_PROXY` and `HTTPS_PROXY` also set as fallback for clients that respect them.
   - `NODE_TLS_REJECT_UNAUTHORIZED=0` so the proxy can intercept HTTPS.
4. Child stdout/stderr are piped directly to the terminal.
5. On child exit, peekr shuts down the proxy server and deletes the temp file.
6. Ctrl+C kills both peekr and the child.

### Routing logic

| Scenario | Behavior |
|---|---|
| No `--target` | Log and forward all outgoing requests to their original destination (transparent proxy). |
| `--target api.example.com` | Log and forward only requests to that host; pass others through silently without logging. |
| `--no-forward` | Log all captured requests; respond with mock 200 and `{}` (or `--mock <json>`). |

### Log output (per request)

Each intercepted request shows:
- Sequential request ID
- Timestamp
- Method + path
- **Destination host** (important in multi-target mode)
- Headers (unless `--no-headers`)
- Request payload
- Response status + body

### Known limitation

Node.js `fetch` (native, Node 18+) does not respect `HTTP_PROXY` env vars. The monkey-patch via `--import` covers this case by patching at the `node:http`/`node:https` level, which underlies all HTTP clients. This covers: Axios, undici, `node-fetch`, `got`, and native `fetch`.

---

## `peekr ui`

### Usage

```bash
peekr ui [--app-port <port>] [--port <port>] [--ui-port <port>] [--target <host>] [--no-forward]

# Combined with run (peekr also starts the app):
peekr ui [--app-port <port>] [--target <host>] -- npm run dev
```

### Ports

| Flag | Default | Purpose |
|---|---|---|
| `--app-port` | 3000 | Port where the user's app listens |
| `--port` | 9999 | peekr outgoing proxy (intercepts traffic leaving the app) |
| `--reverse-port` | 8888 | peekr reverse proxy (intercepts traffic entering the app) |
| `--ui-port` | 4000 | Dashboard web UI |

### Servers started

1. **Proxy server** (9999): same as `peekr run`, intercepts outgoing traffic from the app.
2. **Reverse proxy server** (front of app): receives incoming requests from the outside, logs them, and forwards to `localhost:<app-port>`. This captures traffic entering the app.
3. **UI server** (4000): serves `ui/index.html` and a `/events` SSE endpoint that streams log entries as JSON.

### Traffic flow

```
External client
  → peekr reverse proxy (:8888)   [logs INCOMING requests]
    → user's app (:app-port)
      → outgoing http.request (monkey-patched)
        → peekr outgoing proxy (:9999)   [logs OUTGOING requests]
          → real upstream
```

### Dashboard

- Single-page HTML+JS, no framework, no build step.
- Connects to `GET /events` (SSE).
- Each event renders as a card: direction (IN/OUT), method, host, path, status code, timestamp, collapsible payload.
- No persistence — logs are in-memory for the session.

### Combined mode (`peekr ui -- <command>`)

When `--` is present, peekr also spawns the app process using the same mechanism as `peekr run` (monkey-patch injection). This allows a single command to start both the app and the full observability layer.

---

## Shared: `proxy-core.mjs`

Extracted from the current `peekr.mjs`, this module exports:

```js
createProxyServer({ port, target, noForward, noHeaders, mockBody, onRequest })
```

- `target`: optional host filter. If omitted, proxies all hosts transparently.
- `onRequest`: callback invoked with the full request/response record (used by `peekr ui` to push to SSE clients).

---

## Out of scope (MVP)

- Non-Node.js processes (Python, Go, etc.) — future work.
- Persistent log storage / export.
- HTTPS termination / custom TLS certs.
- Request replay or editing.
- Filter/search in the UI dashboard.
