# peekr

Zero-dependency HTTP capture proxy. Intercepts outgoing calls from any app, logs the full request/response cycle, and optionally forwards to the real upstream service.

No config files. No dependencies. Node.js stdlib only.

## Install

```bash
npm install -g peekr
```

Or run directly without installing:

```bash
npx peekr --target api.example.com
```

## Usage

```
peekr --target <host> [options]
peekr --no-forward [options]
```

### Options

| Flag              | Description                                       | Default |
| ----------------- | ------------------------------------------------- | ------- |
| `--target <host>` | Upstream HTTPS hostname to forward requests to    | —       |
| `--port <port>`   | Local port to listen on                           | 9999    |
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
Your app  →  peekr (localhost:9999)  →  Real upstream (HTTPS)
                    ↓
          Logs method, path,
          headers, payload,
          and response
```

1. Start `peekr` and point your app's base URL env var to `http://localhost:9999`
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
SOME_SERVICE_BASE_URL=http://localhost:9999
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
| `--port <port>`   | Outgoing proxy port                               | 9999    |
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

**How it works:** peekr writes a tiny ESM loader to `/tmp`, injects it via `NODE_OPTIONS=--import`, and monkey-patches `node:http` and `node:https` in the child process so every outgoing request is routed to the local peekr proxy. Works with Axios, `fetch`, `undici`, `got`, and anything that goes through Node's built-in HTTP stack.

---

## `peekr ui` — live web dashboard

`peekr ui` adds a browser-based dashboard with real-time request cards for both incoming and outgoing traffic.

```
peekr ui [options] [-- <command>]
```

### Traffic flow

```
External client → reverse proxy (:8888) → your app (:3000)
                                                ↓ outgoing
                                    peekr proxy (:9999) → real upstream
                                         ↓
                                  dashboard (:4000)
```

### Options

| Flag                   | Description                                    | Default |
| ---------------------- | ---------------------------------------------- | ------- |
| `--app-port <port>`    | Port where your app listens                    | 3000    |
| `--port <port>`        | Outgoing proxy port                            | 9999    |
| `--reverse-port <port>`| Reverse proxy port (in front of your app)      | 8888    |
| `--ui-port <port>`     | Dashboard port                                 | 4000    |
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

Open `http://localhost:4000` to see the live dashboard. Each request appears as a card showing direction (IN/OUT), method, host, path, status code, and collapsible body details.
