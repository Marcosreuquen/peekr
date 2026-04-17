# Peekr Dashboard UI Redesign & Log Decoupling

**Date:** 2026-04-17
**Status:** Draft

## Overview

Redesign peekr's web UI from a simple card list into a professional multi-panel dashboard with filtering, sorting, request detail inspection, and live app logs. Decouple child process output from the terminal and add a `peekr logs` CLI command.

**Constraints:** Zero npm dependencies, Node.js >= 18, ESM only, all UI in a single `ui/index.html`.

---

## 1. Backend: Timing Data

In `proxy-core.mjs`, capture timing around the upstream fetch in `forwardRequest`:

- Record `Date.now()` before and after the forwarded request
- Compute `durationMs = end - start`
- Compute `responseSize = Buffer.byteLength(responseBody)`
- Add both fields to the `onRequest` callback record alongside existing fields (method, host, path, status, headers, body)

The extended request record shape:

```
{
  id, method, host, path, status, headers, body,
  responseHeaders, responseBody,
  durationMs, responseSize, timestamp
}
```

## 2. Backend: Child Process Log Decoupling

### child-runner.mjs changes

- Change `stdio: 'inherit'` to `stdio: ['inherit', 'pipe', 'pipe']` (stdin stays inherited)
- Pipe `child.stdout` and `child.stderr` to:
  1. **Log file:** `{cwd}/.peekr/app.log` — create `.peekr/` dir if missing, truncate file on each `peekr run` start
  2. **SSE broadcast:** emit `app-log` events via the UI server
- Maintain an in-memory circular buffer of the last 1000 lines for SSE initial dump on client connect

### Integration with ui-server.mjs

- Export a function from child-runner (or use an EventEmitter/callback) to forward log lines to ui-server
- ui-server broadcasts `app-log` SSE events to all connected clients
- On SSE client connect, send buffered log lines as initial dump (after the request dump)

## 3. New Command: `peekr logs`

- New subcommand in `bin/peekr.mjs`: `logs`
- Implementation in `lib/logs-command.mjs`
- Reads `{cwd}/.peekr/app.log` and follows new content (poll every 200ms using `fs.stat` + `fs.createReadStream` from last byte offset)
- Flag `--clear` to truncate the log file and exit
- Exits cleanly on SIGINT (Ctrl+C)

## 4. SSE Protocol

### Existing event (extended)

- **`request`** — now includes: `id`, `method`, `host`, `path`, `status`, `headers`, `body`, `responseHeaders`, `responseBody`, `durationMs`, `responseSize`, `timestamp`

### New event

- **`app-log`** — `{ stream: 'stdout' | 'stderr', text: string, timestamp: number }`

### Connection flow

1. Client connects to SSE endpoint
2. Server sends dump of accumulated requests (existing behavior)
3. Server sends dump of buffered app log lines (new)
4. Real-time streaming of both event types

## 5. UI: Layout

Single `ui/index.html` file, CSS Grid layout, dark theme.

```
+------------------------------------------+
|  TOP BAR (filters + search + counter)    |
+---------------------------+--------------+
|                           |              |
|   REQUEST TABLE           | DETAIL DRAWER|
|   (sortable, clickable)   | (tabs)       |
|                           |              |
+---------------------------+--------------+
|  BOTTOM DRAWER (app logs, 3 states)      |
+------------------------------------------+
```

## 6. UI: Top Bar

- **Method filter:** `<select>` with ALL / GET / POST / PUT / DELETE / PATCH / OPTIONS / HEAD
- **Status filter:** `<select>` with ALL / 2xx / 3xx / 4xx / 5xx
- **Host filter:** `<select>` populated dynamically with observed hosts, plus ALL option
- **Search input:** free text, filters by path/host/any visible field (case-insensitive substring match)
- **Counter:** "visible / total" format (e.g., "12 / 47")
- **Clear button:** clears the requests array and re-renders

## 7. UI: Request Table

- **Columns:** `#` (id), Method, Host, Path, Status, Duration (ms), Timestamp
- Click column header to sort (toggle asc/desc)
- Click row to select → opens detail drawer; selected row stays highlighted
- No auto-scroll — user controls scroll position
- **Status colors:** green for 2xx, yellow for 3xx, red for 4xx/5xx
- Method displayed as badge-style with subtle background color

## 8. UI: Detail Drawer (Right)

- Opens on row click, occupies ~35% of viewport width
- **Header:** method + full URL + status badge + duration + response size
- **3 tabs:** Headers | Payload | Response
  - **Headers:** two sections — Request Headers and Response Headers, displayed as key-value pairs
  - **Payload:** request body with JSON syntax highlighting (CSS-only, regex-based tokenization for strings, numbers, booleans, null, keys)
  - **Response:** response body with JSON syntax highlighting
- Non-JSON bodies displayed as plain preformatted text
- **Close button (X)** in top-right corner

## 9. UI: Bottom Drawer (App Logs)

- **3 fixed states:** collapsed (~32px, title bar only), medium (~200px), expanded (~50vh)
- Click title bar to cycle: collapsed → medium → expanded → collapsed
- **Title bar shows:** "App Logs" label + new-lines indicator when collapsed + raw/filtered toggle
- **Raw mode (default):** all output displayed as-is
- **Filtered mode:** buttons for INFO / WARN / ERROR levels; regex-based best-effort parsing of common log formats (e.g., `[INFO]`, `INFO:`, `level: info`)
- **Content:** `<pre>` element with overflow scroll, auto-scroll to bottom (this is a log viewer)
- **Colors:** stderr lines in orange/red tint, stdout in default text color

## 10. UI: Visual Theme

- Dark theme (dark background, light text, similar to browser devtools)
- Monospace font for data (request details, logs, table cells)
- Sans-serif for labels and UI chrome
- Status badges with colored backgrounds
- Simple CSS transitions for drawer open/close (no complex animations)
- Responsive: drawers adapt to viewport, minimum viable at 1024px wide

## 11. Client-Side State & Rendering

### State

```
requests[]          — array of request records, source of truth
filters             — { method, status, host, search }
sortBy / sortDir    — current sort column and direction (asc/desc)
selectedId          — id of selected request (null if none)
logLines[]          — array of { stream, text, timestamp }, capped at 5000
logDrawerState      — 'collapsed' | 'medium' | 'expanded'
logFilter           — 'raw' | 'info' | 'warn' | 'error'
```

### Rendering approach

- Pure functions that take state and produce innerHTML
- Direct DOM manipulation, no framework
- `requestAnimationFrame` throttling for table re-renders when many requests arrive in quick succession
- Filter/sort applied at render time from the full `requests[]` array

## 12. Files Changed

| File | Change |
|------|--------|
| `lib/proxy-core.mjs` | Add timing capture (durationMs, responseSize) to onRequest record |
| `lib/child-runner.mjs` | stdio pipe, log file write, in-memory buffer, SSE integration |
| `lib/ui-server.mjs` | New `app-log` SSE event type, log buffer dump on connect |
| `lib/logs-command.mjs` | New file — `peekr logs` implementation |
| `bin/peekr.mjs` | Add `logs` subcommand dispatch |
| `ui/index.html` | Complete rewrite — new dashboard layout |
