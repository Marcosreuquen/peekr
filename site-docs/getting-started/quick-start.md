# Quick Start

This guide walks through peekr's three modes with real examples. Each section is self-contained — pick the mode that fits your workflow.

---

## Mode 1: Proxy mode

**What it does:** Starts a local HTTP proxy. You point your app's base URL at the proxy, and peekr logs + forwards every request to the real upstream.

**When to use it:** Quick one-off inspection when you can easily change a base URL environment variable.

### Step by step

**1. Start the proxy:**

```bash
peekr --target jsonplaceholder.typicode.com
```

peekr listens on `http://localhost:49999` and forwards to `https://jsonplaceholder.typicode.com`.

**2. Send a request through the proxy:**

```bash
curl http://localhost:49999/todos/1
```

**3. Check the terminal.** You'll see the full request/response logged:

```
================================================================================
[#1]  GET /todos/1
================================================================================

--- Response 200 ---
{
  "userId": 1,
  "id": 1,
  "title": "delectus aut autem",
  "completed": false
}
================================================================================
```

**4. Integrate with your app** by changing the base URL:

```env
# .env
API_BASE_URL=http://localhost:49999
```

Start your app normally — all requests to the configured base URL now flow through peekr.

!!! tip
    Use `--no-forward` to capture requests without forwarding them. Combine with `--mock '{"status":"ok"}'` to return custom responses.

---

## Mode 2: Run mode

**What it does:** Spawns your application as a child process and monkey-patches `node:http` and `node:https` so **all** outgoing HTTP/HTTPS calls are automatically intercepted. No `.env` changes needed.

**When to use it:** You want to see every outgoing call your app makes without touching any configuration.

### Step by step

**1. Run your app through peekr:**

```bash
peekr run -- node server.mjs
```

Or with npm scripts:

```bash
peekr run -- npm run start:dev
```

**2. Trigger some traffic.** Use your app normally — make API calls, hit endpoints, whatever generates outgoing HTTP traffic.

**3. Watch the terminal.** Every outgoing request is logged automatically:

```
================================================================================
[#1]  POST /api/v1/users
→ api.example.com
================================================================================

--- Payload ---
{ "email": "user@example.com", "name": "Jane" }

--- Response 201 ---
{ "id": 42, "email": "user@example.com" }
================================================================================
```

Your app's stdout and stderr are also shown, so you get a unified view of logs + HTTP traffic.

**4. Filter by host** if your app talks to multiple services:

```bash
peekr run --target api.example.com -- npm run start:dev
```

Only requests to `api.example.com` are logged; everything else passes through untouched.

!!! info "How it works"
    peekr writes a tiny ESM loader to `/tmp` and injects it via `NODE_OPTIONS=--import`. This patches Node's HTTP stack in the child process. Works with Axios, `fetch`, `undici`, `got`, and anything built on `node:http`.

---

## Mode 3: UI mode

**What it does:** Launches a browser-based dashboard that shows both **incoming** and **outgoing** HTTP traffic in real time. Incoming traffic is captured via a reverse proxy in front of your app.

**When to use it:** You want a visual overview of all traffic flowing through your application, or you need to inspect both directions.

### Traffic flow

```
External client → reverse proxy (:49998) → your app (:3000)
                                                ↓ outgoing
                                    peekr proxy (:49999) → real upstream
                                         ↓
                                  dashboard (:49997)
```

### Step by step

**1. Start peekr with the dashboard:**

```bash
peekr ui --app-port 3000 -- npm run start:dev
```

This starts your app, the reverse proxy, and the dashboard.

**2. Open the dashboard** at [http://localhost:49997](http://localhost:49997).

**3. Send incoming traffic** to the reverse proxy instead of your app directly:

```bash
curl http://localhost:49998/api/health
```

**4. Watch the dashboard.** Each request appears as a card showing:

- Direction: **IN** (incoming) or **OUT** (outgoing)
- Method, host, path, and status code
- Collapsible headers and body details
- Timing information

**5. If your app is already running** separately, you can attach just the dashboard:

```bash
peekr ui --app-port 3000
```

Note: in this mode, only incoming traffic is captured. To capture outgoing traffic too, start your app through peekr using `--`.

!!! tip
    The dashboard uses Server-Sent Events (SSE) for real-time updates — no polling, no WebSocket setup.

---

## Choosing the right mode

| Scenario | Recommended mode |
|----------|-----------------|
| Quick check of a specific API call | **Proxy** — start proxy, curl through it |
| Debug all outgoing calls from your app | **Run** — automatic interception, no config |
| Full traffic overview in a browser | **UI** — both directions, visual dashboard |
| CI/testing with captured traffic | **Run** with `--log-file` for persistent logs |
| Demo or pair programming | **UI** — easy to share a screen with the dashboard |

---

## Next steps

- Learn about the [Rules Engine](../guides/rules-engine.md) to block or mock requests dynamically
- Explore the [Dashboard UI](../guides/dashboard.md) features in detail
- See the full [CLI Reference](../reference/cli.md) for all options and flags
