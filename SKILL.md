---
name: peekr
description: Use when the user needs to mock endpoints, capture incoming or outgoing application HTTP/HTTPS calls, block URLs or hosts, inspect request/response structures, monitor traffic flows, debug proxy behavior, or write tests that exercise different HTTP or HTML response cases with Peekr.
---

# Peekr

Peekr is a local HTTP capture proxy for development and tests. Use it to inspect traffic, route app calls through a proxy, mock responses, block hosts or paths, and observe incoming plus outgoing request flows without changing application code more than necessary.

## Command Resolution

Peekr is published on npm. Never instruct users to run Peekr from source files, repository paths, `node bin/peekr.mjs`, or any local package internals. Resolve the command as an installed CLI first, then fall back to `npx`:

1. If the `peekr` command exists in the user's environment, use:
   ```bash
   peekr ...
   ```
2. Otherwise use the npm package fallback:
   ```bash
   npx @marcosreuquen/peekr ...
   ```

When documenting examples for users, write commands as `peekr ...` for readability, but mention `npx @marcosreuquen/peekr ...` when the binary may not be installed or when the user wants to run it without installing.

## Choose The Mode

- **Proxy mode:** Use when the app can point a base URL to Peekr. Start `peekr --target api.example.com`, then set the app URL to `http://localhost:49999`.
- **Run mode:** Use when a Node app should be launched with all outgoing `node:http` and `node:https` calls intercepted. Start `peekr run -- npm run dev` or `peekr run -- node server.js`.
- **UI mode:** Use when the user needs a dashboard, incoming traffic, outgoing traffic, rules, breakpoints, or visual monitoring. Start `peekr ui --app-port 3000 -- npm run dev`; open `http://localhost:49997`; send incoming calls to `http://localhost:49998`.
- **Logs mode:** Use `peekr logs` when the app was spawned by Peekr and stdout/stderr are needed separately.

Default ports:

| Purpose | Port |
| --- | --- |
| Outgoing proxy | `49999` |
| Reverse proxy for incoming traffic | `49998` |
| Dashboard UI and rules API | `49997` |
| App target in UI mode | `3000` |

## Core Workflows

### Capture outgoing calls

Use proxy mode when the app has a configurable upstream:

```bash
peekr --target api.example.com
```

Then point the app's base URL to:

```env
API_BASE_URL=http://localhost:49999
```

Use run mode when changing app config is inconvenient:

```bash
peekr run -- npm run dev
```

Add `--target api.example.com` to focus on one host and pass other hosts through.

### Capture incoming and outgoing traffic

Use UI mode:

```bash
peekr ui --app-port 3000 -- npm run dev
```

Open `http://localhost:49997`. Send test clients, curl, browsers, or integration tests to the reverse proxy:

```bash
curl http://localhost:49998/api/health
```

If the app is already running and Peekr is started without `-- <command>`, only incoming traffic is captured. Start the app through Peekr to capture outgoing traffic too.

### Mock endpoints

For simple capture-only mocks:

```bash
peekr --target api.example.com --no-forward --mock '{"ok":true}'
```

For route-specific mocks, use UI mode and create a modify rule through the dashboard or the rules API:

```bash
curl -X POST http://localhost:49997/api/rules \
  -H "Content-Type: application/json" \
  -d '{
    "host": "api.example.com",
    "method": "GET",
    "path": "/api/v1/config",
    "action": "modify",
    "direction": "OUT",
    "modifyConfig": {
      "noForward": true,
      "res": {
        "setBody": "{\"feature_flags\":{\"new_ui\":true}}",
        "setHeaders": { "content-type": "application/json" }
      }
    }
  }'
```

### Mock HTML responses

When testing application behavior across HTML response cases, create `modify` rules with `noForward: true` and explicit `content-type` headers:

```bash
curl -X POST http://localhost:49997/api/rules \
  -H "Content-Type: application/json" \
  -d '{
    "host": "site.example.com",
    "method": "GET",
    "path": "/landing",
    "action": "modify",
    "modifyConfig": {
      "noForward": true,
      "res": {
        "setBody": "<!doctype html><html><body><h1>Variant A</h1></body></html>",
        "setHeaders": { "content-type": "text/html; charset=utf-8" }
      }
    }
  }'
```

Create separate rules for success, empty HTML, malformed HTML, redirects represented by app-level HTML, error pages, and edge-case encodings as needed.

### Block URLs or hosts

Use a block rule:

```bash
curl -X POST http://localhost:49997/api/rules \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ads.tracker.com",
    "method": "*",
    "path": "/",
    "action": "block"
  }'
```

Matched requests return `403` and do not reach the upstream server. Use `direction: "IN"` or `direction: "OUT"` when a rule must apply only to incoming or outgoing traffic.

### Inspect and alter request flow

Use a breakpoint rule when the user needs to pause, inspect, edit, resume, abort, or mock a request from the dashboard:

```bash
curl -X POST http://localhost:49997/api/rules \
  -H "Content-Type: application/json" \
  -d '{
    "host": "api.example.com",
    "method": "POST",
    "path": "/checkout",
    "action": "breakpoint",
    "phase": "request"
  }'
```

Use this for uncertain payloads, auth debugging, checkout/payment flows, webhook analysis, and tests that need manual or scripted intervention.

## Rule Semantics

Rules are in-memory and reset when Peekr restarts. Matching is first-match-wins:

1. `host` is an exact hostname match.
2. `method` is exact, or `*` for all methods.
3. `path` is a prefix match.
4. `direction` is optional: `IN`, `OUT`, or omitted for both.

Actions:

| Action | Use for |
| --- | --- |
| `block` | Reject traffic with `403` before upstream |
| `modify` | Change request/response headers or body; set `noForward: true` for mocks |
| `breakpoint` | Pause at `request`, `response`, or `both` for inspection and edits |

## Test Guidance

- Prefer `peekr run --log-file ./capture.log -- <test command>` for automated tests that need durable traffic evidence.
- Prefer `peekr ui -- <test app command>` when tests need rules, incoming capture, outgoing capture, or breakpoints.
- Use unique ports with `--port`, `--reverse-port`, and `--ui-port` for parallel test runs.
- Add rules through `POST http://localhost:49997/api/rules` before triggering the tested flow.
- Verify behavior from the application side and from Peekr logs or dashboard records; do not rely only on "server started" output.
- Keep mocks explicit about status, headers, and body shape, especially for JSON vs HTML cases.

## Troubleshooting

- If no outgoing calls appear in UI mode, confirm the app was started after `--`; attaching to an already running app captures only incoming traffic.
- If a rule does not match, check exact `host`, method, path prefix, and direction.
- If `--mock` behaves unexpectedly, validate that the JSON is valid and shell-escaped correctly.
- If a target HTTPS service is configured manually, use `--target <host>` without `https://`; Peekr forwards to HTTPS for target mode.
- If a port is busy, choose explicit ports or use a `peekr.config.json` / `.peekrrc.json` with `ports.proxy`, `ports.reverseProxy`, `ports.ui`, and `ports.app`.
