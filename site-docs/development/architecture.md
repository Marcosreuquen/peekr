# Architecture

This document describes peekr's internal architecture, module responsibilities, data flows, and key design decisions.

## Directory Structure

```
bin/
  peekr.mjs              CLI entry point, subcommand dispatch (run/ui/logs/proxy)

lib/
  args.mjs               getArg, getAllArgs, hasFlag, listenOnAvailablePort helpers
  child-runner.mjs       Spawns child process with stdio piped, logs to .peekr/app.log
                          + in-memory buffer (1000 lines) + onLogEntry callback for SSE
  intercept-template.mjs Generates ESM loader code that monkey-patches node:http/node:https,
                          injected via NODE_OPTIONS=--import
  logger.mjs             Colored console logging + setLogFile
  logs-command.mjs       peekr logs implementation (tail .peekr/app.log)
  proxy-core.mjs         Outgoing HTTP proxy server. Receives intercepted requests, logs them,
                          optionally forwards to upstream. Integrates rules engine.
  reverse-proxy.mjs      Reverse proxy for incoming traffic. Captures IN requests with timing
                          data (durationMs, responseSize, resHeaders).
  rules-engine.mjs       In-memory rules store. addRule/removeRule/getRules/findMatch.
  run-command.mjs        peekr run implementation. Sets up proxy + child runner.
  ui-command.mjs         peekr ui implementation. Wires proxy + reverse proxy + ui-server + rules.
  ui-server.mjs          Serves ui/index.html, SSE endpoint with named events, REST API for rules.

ui/
  index.html             Single-file dashboard (~970 lines). Dark theme, CSS Grid, real-time SSE.
```

## Module Dependency Graph

```
bin/peekr.mjs
  ├── lib/run-command.mjs
  │     ├── lib/proxy-core.mjs
  │     │     └── lib/rules-engine.mjs
  │     ├── lib/child-runner.mjs
  │     │     └── lib/logger.mjs
  │     ├── lib/intercept-template.mjs
  │     └── lib/args.mjs
  ├── lib/ui-command.mjs
  │     ├── lib/proxy-core.mjs
  │     ├── lib/reverse-proxy.mjs
  │     ├── lib/child-runner.mjs
  │     ├── lib/ui-server.mjs
  │     │     └── lib/rules-engine.mjs
  │     ├── lib/intercept-template.mjs
  │     └── lib/args.mjs
  ├── lib/logs-command.mjs
  └── lib/args.mjs
```

## Data Flow

### Proxy Mode (`peekr --target <host>`)

```
  Your App
    │
    │  HTTP request (manually configured to use proxy)
    ▼
  peekr proxy (localhost:49999)
    │
    ├── Rules engine check
    │     ├── block  → 403 Forbidden
    │     └── mock   → custom response
    │
    │  (if no rule matches)
    ▼
  Upstream HTTPS server
```

The proxy server (`proxy-core.mjs`) listens on a local port and receives HTTP requests. Each request is logged and checked against the rules engine. If no rule matches, the request is forwarded to the upstream target.

### Run Mode (`peekr run -- <command>`)

```
  peekr run -- node app.js
    │
    ├── Writes ESM loader to /tmp/peekr-loader.mjs
    ├── Sets NODE_OPTIONS=--import /tmp/peekr-loader.mjs
    ├── Starts proxy server (localhost:49999)
    └── Spawns child process
          │
          │  Child's http/https modules are monkey-patched
          │  All outgoing requests route through peekr proxy
          ▼
        peekr proxy (localhost:49999)
          │
          ▼
        Upstream server
```

The intercept template (`intercept-template.mjs`) generates an ESM loader that patches `node:http` and `node:https` request methods. The child process's outgoing traffic is transparently routed through the proxy without any code changes in the target application.

Child process stdout/stderr are piped to:
- `.peekr/app.log` (file)
- In-memory circular buffer (1000 lines)
- SSE broadcast via `onLogEntry` callback

### UI Mode (`peekr ui`)

```
  External Client
    │
    ▼
  Reverse Proxy (:49998)  ──captures IN requests──►  Dashboard (:49997)
    │                                                      ▲
    ▼                                                      │
  Your App (:3000)                                    SSE events
    │                                                 (request, app-log,
    │  outgoing HTTP                                   rules-change)
    ▼
  Proxy (:49999)  ──captures OUT requests──────────────────┘
    │
    ▼
  Upstream server
```

UI mode combines all components:
- **Reverse proxy** (`:49998`) sits in front of the user's app, capturing incoming requests with timing data
- **Outgoing proxy** (`:49999`) captures all outgoing HTTP/HTTPS from the child process
- **Dashboard** (`:49997`) serves the single-file HTML UI and SSE endpoint

Both incoming and outgoing requests are visible in the dashboard in real time.

## SSE Protocol

The UI server (`ui-server.mjs`) exposes an SSE endpoint that streams named events to the dashboard.

### Event Types

| Event | Payload | Description |
|-------|---------|-------------|
| `request` | Request object (JSON) | New captured HTTP request (incoming or outgoing) |
| `app-log` | Log line (JSON string) | Child process stdout/stderr line |
| `rules-change` | Rules array (JSON) | Rules list updated (add/remove) |

### Connection Behavior

On client connect, the server replays:
1. All buffered requests (from the in-memory circular buffer)
2. Current rules state

This ensures the dashboard is fully populated even if the client connects after traffic has already been captured.

### REST API

The UI server also exposes a REST API for rules management:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/rules` | List all rules |
| `POST` | `/api/rules` | Add a new rule |
| `DELETE` | `/api/rules` | Remove a rule |

Rule changes trigger an SSE `rules-change` broadcast to all connected clients.

## Rules Engine

Rules are stored in memory and matched against incoming requests.

**Rule structure:**
```json
{
  "id": "unique-id",
  "host": "example.com",
  "method": "GET",
  "path": "/api/users",
  "action": "block | mock",
  "mockConfig": { "status": 200, "body": "..." }
}
```

**Matching priority:** host (exact) → method (wildcard supported) → path (prefix match). First match wins.

**Actions:**
- `block` — responds with 403 Forbidden
- `mock` — responds with custom status, headers, and body from `mockConfig`

## Design Decisions

### Zero Dependencies

peekr uses only Node.js built-in modules (`node:http`, `node:https`, `node:fs`, `node:child_process`, `node:net`, etc.). This eliminates supply chain risk, keeps install instant, and avoids version conflicts.

### ESM Only

The project uses ES modules exclusively (`"type": "module"` in `package.json`). This aligns with Node.js's module direction and enables the `--import` loader mechanism used for HTTP interception.

### Single HTML Dashboard

The entire dashboard UI is a single `index.html` file with inline CSS and JavaScript — no build step, no bundler, no framework. This keeps the development workflow simple and eliminates frontend tooling complexity.

### In-Memory State

All captured requests, logs, and rules live in memory. Nothing persists across restarts. This is intentional — peekr is a development tool, not a monitoring system. Simplicity over durability.

### Monkey-Patching via ESM Loader

The `--import` flag injects an ESM loader that patches `http.request`, `http.get`, `https.request`, and `https.get` at the module level. A double-patch guard prevents re-patching if the loader is imported multiple times.

### Loop Detection

The proxy core detects request loops (proxy calling itself) and responds with HTTP 508 (Loop Detected) to prevent infinite recursion.

### ANSI Stripping

Log lines from child processes may contain ANSI escape codes. These are stripped for log-level filtering and clean display in the dashboard.
