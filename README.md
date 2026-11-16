# peekr

Zero-dependency HTTP capture proxy. Intercepts outgoing calls from any app, logs the full request/response cycle, and optionally forwards to the real upstream service.

No required config files. No dependencies. Node.js stdlib only.

## Install

```bash
npm install -g @marcosreuquen/peekr
```

Or run directly without installing:

```bash
npx @marcosreuquen/peekr --target api.example.com
```

## Usage

### Experimental workspaces

To try a local three-service workspace after installing Peekr (requires Python 3 and OpenSSL):

```bash
peekr demo
```

Open the printed dashboard URL, then visit the printed flow URL to generate
traffic. The flow runs through `gateway-node`, `orders-node`, and
`inventory-python`. Stop all demo processes with Ctrl+C.

The printed **Circular + external** URL demonstrates `gateway-node →
orders-node → gateway-node → inventory-python`, plus a request to a simulated
external catalog running locally outside the workspace.

Use **Intercept: On** in the dashboard to pause incoming and outgoing requests
before rules are applied. Review, edit, continue, mock, or block them in the
breakpoints panel. Switching interception off continues pending global
intercepts; individually configured breakpoints remain active. Interception
only applies to traffic routed through Peekr.

In a workspace, **Graph** displays registered services and observed outgoing
connections. Local destinations are identified by their app or reverse-proxy
ports; other destinations appear as external nodes. Arrows represent observed
traffic and configured connections. Select a service node to filter requests,
or an arrow to inspect its traffic or configure a source-specific block,
response modification, or redirect. **Connect** creates a rule before traffic
is observed. Redirects accept an HTTP or HTTPS origin and retain the request
path. Drag service nodes to adjust the layout.

Requests appear as pending as soon as they continue from interception, and the
same row is updated when the response arrives.

Start a workspace and register an already running HTTP service from its project directory:

```bash
peekr workspace start --name local
peekr add --workspace local --name api --app-port 3000
```

The command prints the reverse proxy URL and stores the service definition in
`.peekr/services/local.json`. Requests sent to that URL are forwarded to the
application and displayed in the dashboard. Use `--project <path>` to
select another project directory and `--reverse-port <port>` to request a port.
If only one workspace is running, `--workspace` can be omitted. The service
name defaults to the project directory name, and the app port to `3000`.
To start the service directly, use `peekr add -- npm run start`. The command
runs in the foreground with proxy and CA environment variables. The workspace
URL opens a dashboard for adding running services and viewing captured traffic.

Save the running workspace explicitly with
`peekr workspace save --workspace local --file workspace.json`. The file
includes services, rules and graph positions. To restore it and optionally start
its configured commands:

```bash
peekr workspace start --config workspace.json
peekr workspace start --config workspace.json --start-services
```

The Services panel edits and removes services and starts or stops processes
started by the workspace. A process launched separately, including through
`peekr add -- <command>`, remains external and is not stopped by the workspace.
Reachability indicates whether the app port accepts TCP connections, not whether
its outgoing HTTP client actually uses the proxy.

A workspace can optionally load a JSON file using `peekr workspace start --name local --config workspace.json`:

```json
{ "services": [{ "name": "api", "appPort": 3000 }] }
```

Each service has an incoming HTTP reverse proxy and an outgoing HTTP/HTTPS proxy.
The workspace generates a private local CA in `~/.peekr/ca` using OpenSSL and
configures compatible child processes to trust it. Do not share its private key.
The outgoing proxy only sees clients configured to use it. Python Requests
honors the supplied proxy and CA environment variables; other clients may need
explicit proxy configuration. Node's `NODE_USE_ENV_PROXY` support depends on
the Node version and client. Already-running services need to be restarted with
their proxy and CA configured; `peekr add` prints both paths. Certificate pinning,
mutual TLS, WebSockets and HTTP/2 are not supported by this workspace proxy.
Workspace definitions are loaded explicitly; they are not automatically saved.

```
peekr --target <host> [options]
peekr --no-forward [options]
```

### Options

| Flag              | Description                                       | Default |
| ----------------- | ------------------------------------------------- | ------- |
| `--target <host>` | Upstream HTTPS hostname to forward requests to    | —       |
| `--port <port>`   | Local port to listen on                           | 49999   |
| `--config <path>` | Read ports from a JSON config file                | —       |
| `--no-forward`    | Capture only — don't forward, return a mock 200   | false   |
| `--no-headers`    | Omit headers from log output                      | false   |
| `--mock <json>`   | Custom JSON body to return in `--no-forward` mode | `{}`    |
| `-h, --help`      | Show help                                         |         |

## Examples

### Capture and forward to a real API

```bash
peekr --target api.example.com
```

### Capture without forwarding (safe / offline testing)

```bash
peekr --no-forward
```

### Custom mock response

```bash
peekr --no-forward --mock '{"status":"ok","id":42}'
```

### Custom port, hide headers

```bash
peekr --target api.example.com --port 8080 --no-headers
```

## How it works

```
Your app  →  peekr (localhost:49999)  →  Real upstream (HTTPS)
                    ↓
          Logs method, path,
          headers, payload,
          and response
```

1. Start `peekr` and point your app's base URL env var to `http://localhost:49999`
2. Your app sends requests normally — it just thinks the service is local
3. `peekr` logs everything and forwards to the real upstream
4. Restore the original URL when done

## Step-by-step example (NestJS + any HTTP client)

**1. Start peekr:**

```bash
peekr --target unification.useinsider.com
```

**2. Change the base URL in your app's `.env`:**

```env
SOME_SERVICE_BASE_URL=http://localhost:49999
```

**3. Start your app and trigger the flow as usual.**

**4. Check the peekr terminal:**

```
================================================================================
[#1] 2025-01-15T20:30:00.000Z  POST /api/user/v1/upsert
================================================================================

--- Headers ---
{ "content-type": "application/json", "x-api-key": "..." }

--- Payload ---
{
  "users": [
    {
      "identifiers": { "email": "user@example.com" },
      "attributes": { "custom": { "person_key": "PK-12345" } }
    }
  ]
}

--- Response 200 ---
{ "data": { "successful": { "count": 1 } } }
================================================================================
```

**5. Restore the original URL and stop peekr.**

## Requirements

- Node.js >= 18
- No npm dependencies

---

## `peekr run` — automatic HTTP interception

`peekr run` spawns your app as a child process and automatically intercepts **all** outgoing HTTP/HTTPS traffic — no `.env` changes needed.

```
peekr run [options] -- <command>
```

### Options

| Flag              | Description                                       | Default |
| ----------------- | ------------------------------------------------- | ------- |
| `--port <port>`   | Outgoing proxy port                               | 49999   |
| `--config <path>` | Read ports from a JSON config file                | —       |
| `--target <host>` | Only log requests to this host (pass-through rest)| —       |
| `--no-forward`    | Capture only — return mock 200, don't forward     | false   |
| `--no-headers`    | Omit headers from log output                      | false   |
| `--mock <json>`   | Custom JSON body for `--no-forward` mode          | `{}`    |

### Examples

```bash
# Intercept all outgoing calls from a Node app
peekr run -- node server.mjs

# Intercept npm dev script, only log requests to api.example.com
peekr run --target api.example.com -- npm run dev

# Capture without forwarding
peekr run --no-forward -- node server.mjs
```

**How it works:** peekr writes a tiny loader to `/tmp`, injects it with `NODE_OPTIONS=--import` on Node 18.19+ / 20+, and falls back to `NODE_OPTIONS=--require` on older Node 18 releases. The loader monkey-patches `node:http` and `node:https` in the child process so every outgoing request is routed to the local peekr proxy.

---

## `peekr ui` — live web dashboard

`peekr ui` adds a browser-based dashboard with real-time request cards for both incoming and outgoing traffic.

```
peekr ui [options] [-- <command>]
```

### Traffic flow

```
External client → reverse proxy (:49998) → your app (:3000)
                                                ↓ outgoing
                                    peekr proxy (:49999) → real upstream
                                         ↓
                                  dashboard (:49997)
```

### Options

| Flag                   | Description                                    | Default |
| ---------------------- | ---------------------------------------------- | ------- |
| `--app-port <port>`    | Port where your app listens                    | 3000    |
| `--port <port>`        | Outgoing proxy port                            | 49999   |
| `--reverse-port <port>`| Reverse proxy port (in front of your app)      | 49998   |
| `--ui-port <port>`     | Dashboard port                                 | 49997   |
| `--config <path>`      | Read ports from a JSON config file             | —       |
| `--target <host>`      | Only log outgoing requests to this host        | —       |
| `--no-forward`         | Capture only — return mock 200                 | false   |
| `--no-headers`         | Omit headers from log output                   | false   |
| `--mock <json>`        | Custom JSON body for `--no-forward` mode       | `{}`    |

### Examples

```bash
# App already running on :3000 — just attach the dashboard
peekr ui --app-port 3000

# Start your app through peekr (intercepts outgoing too)
peekr ui --app-port 3000 -- npm run dev
```

Open `http://localhost:49997` to see the live dashboard. Each request appears as a card showing direction (IN/OUT), method, host, path, status code, and collapsible body details.

## Optional config file

Ports can be set with flags or in `peekr.config.json` / `.peekrrc.json`. Flags take precedence over config values.

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

Use a different file with `--config ./path/to/peekr.config.json`.
