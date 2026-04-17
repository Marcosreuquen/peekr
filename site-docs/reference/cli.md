# CLI Reference

Peekr provides four commands, each suited to a different workflow. All commands share a common set of capture flags.

---

## `peekr` — Standalone Proxy

Starts an HTTP capture proxy. Point your application's outgoing requests at `localhost:<port>` to intercept them.

**When to use:** You control the target URL in your app and can point it at a local proxy, or you want a lightweight capture without modifying how your app starts.

```bash
# Forward traffic to api.example.com
peekr --target api.example.com

# Capture only — don't forward, return mock 200
peekr --target api.example.com --no-forward

# Custom mock response
peekr --target api.example.com --no-forward --mock '{"ok":true}'
```

| Flag | Description | Default |
|------|-------------|---------|
| `--target <host>` | Upstream HTTPS hostname to forward to | — |
| `--port <port>` | Local proxy port | `49999` |
| `--no-forward` | Capture only, return mock 200 | `false` |
| `--no-headers` | Omit headers from log output | `false` |
| `--mock <json>` | Custom mock response body (used with `--no-forward`) | — |
| `-h, --help` | Show help | — |

---

## `peekr run` — Spawn & Intercept

Spawns a child process with monkey-patched HTTP/HTTPS modules. All outgoing calls are automatically intercepted via `NODE_OPTIONS --import` — no code changes required.

**When to use:** You want zero-config interception of a Node.js process without changing any URLs in your code.

```bash
# Intercept all outgoing HTTP from a Node script
peekr run -- node app.js

# Only capture requests to a specific host
peekr run --target api.example.com -- npm start

# Capture without forwarding, write logs to file
peekr run --no-forward --log-file ./capture.log -- node server.js
```

| Flag | Description | Default |
|------|-------------|---------|
| `--port <port>` | Outgoing proxy port | `49999` |
| `--target <host>` | Only log requests to this host; pass the rest through | — |
| `--no-forward` | Capture only, don't forward | `false` |
| `--no-headers` | Omit headers from log output | `false` |
| `--mock <json>` | Custom mock response body | — |
| `--log-file <path>` | Write logs to a file | — |
| `-h, --help` | Show help | — |

---

## `peekr ui` — Live Web Dashboard

Starts a full inspection stack: a reverse proxy for **incoming** traffic, an outgoing capture proxy, and a live web dashboard to view everything in real time. Optionally spawns your app as a child process.

**When to use:** You want a visual, real-time view of both incoming and outgoing HTTP traffic.

```bash
# Launch dashboard, proxy incoming traffic to app on port 3000
peekr ui

# Spawn the app and inspect everything
peekr ui -- node server.js

# Custom ports
peekr ui --app-port 8080 --ui-port 3001 -- npm start
```

### Traffic Flow

```
External client ──▶ reverse proxy (:49998) ──▶ your app (:3000)
                                                    │ outgoing
                                        peekr proxy (:49999) ──▶ real upstream
                                             │
                                      dashboard (:49997)
```

| Flag | Description | Default |
|------|-------------|---------|
| `--app-port <port>` | Port your application listens on | `3000` |
| `--port <port>` | Outgoing capture proxy port | `49999` |
| `--reverse-port <port>` | Reverse proxy port (clients connect here) | `49998` |
| `--ui-port <port>` | Dashboard web UI port | `49997` |
| `--target <host>` | Only log outgoing requests to this host | — |
| `--no-forward` | Capture only, don't forward outgoing requests | `false` |
| `--no-headers` | Omit headers from log output | `false` |
| `--mock <json>` | Custom mock response body | — |
| `--log-file <path>` | Write logs to a file | — |
| `-h, --help` | Show help | — |

---

## `peekr logs` — Follow App Logs

Tails the child process log file at `.peekr/app.log`. Useful when your app was spawned by `peekr run` or `peekr ui` and you want to see its stdout/stderr separately.

**When to use:** Your app is running as a peekr child process and you want to follow its output in a separate terminal.

```bash
# Follow logs
peekr logs

# Clear the log file
peekr logs --clear
```

| Flag | Description | Default |
|------|-------------|---------|
| `--clear` | Clear the log file and exit | `false` |
| `-h, --help` | Show help | — |
