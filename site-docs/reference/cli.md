# CLI Reference

Peekr provides four commands, each suited to a different workflow. All commands share a common set of capture flags.

## Experimental Workspaces

Start a workspace and open the printed URL to manage services and inspect traffic:

```bash
peekr workspace start --name local
peekr add --workspace local --name api --app-port 3000 -- python app.py
peekr workspace save --workspace local --file workspace.json
peekr workspace start --config workspace.json --start-services
```

Each service gets a local incoming reverse proxy and an outgoing HTTP/HTTPS
proxy. Peekr uses OpenSSL to generate a local CA in `~/.peekr/ca`. For launched
services it sets proxy and CA environment variables; clients must support those
variables or be configured explicitly. Node proxy support varies by version and
HTTP client. For an already-running service, `peekr add` prints the outgoing
proxy and CA paths; configure and restart the service to use them. The workspace
dashboard can register running services and inspect their captured traffic.
Certificate pinning, mutual TLS, WebSockets and HTTP/2 are not supported.

The Services panel can edit and remove services, and start or stop processes
managed by the workspace. TCP reachability is separate from whether incoming,
outgoing or HTTPS traffic has actually been observed. `peekr add -- <command>`
launches its process from the CLI, so the workspace treats it as external.

**Graph** shows observed and configured connections. **Connect** creates a
source-scoped outgoing rule, while clicking an arrow opens its rule and traffic
controls. Redirects accept an HTTP/HTTPS origin and keep the original path.
Save the workspace to persist services, rules and node positions; existing files
are not overwritten. The optional `--start-services` flag starts saved commands.
Pending requests can be continued or blocked individually or in bulk.

Ports can also be read from `peekr.config.json` or `.peekrrc.json`. Use `--config <path>` to point at a different JSON file. CLI flags always take precedence over config values.

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
| `--config <path>` | Read ports from a JSON config file | — |
| `--no-forward` | Capture only, return mock 200 | `false` |
| `--no-headers` | Omit headers from log output | `false` |
| `--mock <json>` | Custom mock response body (used with `--no-forward`) | — |
| `-h, --help` | Show help | — |

---

## `peekr run` — Spawn & Intercept

Spawns a child process with monkey-patched HTTP/HTTPS modules. Outgoing calls are automatically intercepted via `NODE_OPTIONS --import` on Node 18.19+ / 20+, or `NODE_OPTIONS --require` on older Node 18 releases — no code changes required.

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
| `--config <path>` | Read ports from a JSON config file | — |
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
| `--config <path>` | Read ports from a JSON config file | — |
| `--target <host>` | Only log outgoing requests to this host | — |
| `--no-forward` | Capture only, don't forward outgoing requests | `false` |
| `--no-headers` | Omit headers from log output | `false` |
| `--mock <json>` | Custom mock response body | — |
| `--log-file <path>` | Write logs to a file | — |
| `-h, --help` | Show help | — |

---

## Port Config File

`peekr.config.json` and `.peekrrc.json` are discovered from the current working directory.

```json
{
  "ports": {
    "proxy": 49999,
    "reverseProxy": 49998,
    "ui": 49997,
    "app": 3000
  }
}
```

Supported port keys are `proxy`, `reverseProxy`, `ui`, and `app`. Top-level aliases such as `proxyPort`, `reverseProxyPort`, `uiPort`, and `appPort` are also accepted.

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
