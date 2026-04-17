# Dashboard UI

The peekr dashboard is a real-time web interface for inspecting HTTP traffic flowing through the proxy. Launch it with:

```bash
peekr ui
```

Then open [http://localhost:3000](http://localhost:3000) in your browser (the port depends on your configuration).

## Traffic Flow

```
Client Request
      |
      v
+------------------+       SSE: request event
|   peekr proxy    | --------------------------> [ Dashboard ]
+------------------+                              (browser)
      |
      v
  Upstream Server
```

Every request that passes through peekr is captured and streamed to the dashboard via Server-Sent Events (SSE). When you first open the dashboard, buffered requests are replayed so you immediately see recent traffic.

## Layout Overview

The dashboard uses a 3-panel CSS Grid layout:

| Area | Position | Purpose |
|------|----------|---------|
| Top bar | Top | Filter controls and drawer toggles |
| Request table | Center | Scrollable list of captured requests |
| Detail drawer | Right | Headers, payload, and response inspection |
| Rules drawer | Left | Active rules list and rule creation form |
| Log drawer | Bottom | Child process stdout/stderr output |

## Top Bar Filters

The top bar provides several controls to narrow down displayed traffic:

- **Method** -- Dropdown to filter by HTTP method (GET, POST, PUT, DELETE, etc.).
- **Status** -- Dropdown to filter by response status code range (2xx, 3xx, 4xx, 5xx).
- **Direction** -- Toggle between **IN** (incoming) and **OUT** (outgoing) traffic.
- **Search** -- Free-text input that matches against host and path.

Filters combine with AND logic -- only requests matching all active filters are shown.

### Drawer Toggles

Three icon buttons on the right side of the top bar control drawer visibility:

| Icon | Drawer |
|------|--------|
| Gear | Rules drawer (left) |
| Hamburger | Log drawer (bottom) |
| Play | Detail drawer (right) |

## Request Table

The main area displays a table of captured requests with the following columns:

| Column | Description |
|--------|-------------|
| **#** | Sequential request number |
| **Direction** | `IN` or `OUT` badge |
| **Method** | HTTP method (GET, POST, etc.) |
| **Host** | Target hostname |
| **Path** | Request path |
| **Status** | HTTP response status code |
| **Duration** | Round-trip time in milliseconds |
| **Size** | Response body size |

**Sorting** -- Click any column header to sort by that column. Click again to reverse the sort order.

**Selecting** -- Click a row to open the detail drawer with full request/response information.

### Badges

Some rows display colored badges indicating rule matches:

- **BLK** (red) -- The request matched a **block** rule and was rejected with a `403` response.
- **MCK** (orange) -- The request matched a **mock** rule and received a configured mock response.

## Detail Drawer

The right-side drawer shows full details for the selected request. It has three size states, cycled by clicking the toggle button:

1. **Collapsed** -- Hidden.
2. **Medium** -- Approximately 40% of the viewport width.
3. **Expanded** -- Approximately 65% of the viewport width.

### Tabs

| Tab | Content |
|-----|---------|
| **Headers** | Request and response headers displayed as key-value pairs |
| **Payload** | Request body (form data, JSON, etc.) |
| **Response** | Response body with JSON syntax highlighting |

JSON bodies are automatically syntax-highlighted using CSS-only regex tokenization -- no external libraries required.

## Log Drawer

The bottom drawer shows stdout and stderr output from child processes managed by peekr. It has three fixed height states:

1. **Collapsed** -- Thin bar, no content visible.
2. **Medium** -- Approximately 200px tall.
3. **Expanded** -- Approximately 400px tall.

### Log Level Filtering

Four filter buttons control which log lines are displayed:

| Button | Shows |
|--------|-------|
| **ALL** | All log output |
| **INFO** | Informational messages only |
| **WARN** | Warnings only |
| **ERR** | Errors only |

ANSI escape codes are automatically stripped before filtering and display.

## Context Menu

Right-click any request row to open a context menu with two options:

- **Block this host** -- Creates a block rule for the request's host. Future requests to that host will receive a `403 Forbidden` response.
- **Mock this host** -- Creates a mock rule for the request's host. Opens the rules drawer to configure the mock response.

Both actions create rules via `POST /api/rules`. See the [Rules Engine guide](rules-engine.md) for details on how rules work.

## Real-Time Updates

The dashboard maintains an SSE connection to the proxy server. Three named event types keep the UI in sync:

| Event | Purpose |
|-------|---------|
| `request` | New request captured -- adds a row to the table |
| `app-log` | Child process log output -- appends to the log drawer |
| `rules-change` | Rule created or deleted -- refreshes the rules drawer |

If the connection drops, the dashboard reconnects automatically. On reconnect, buffered events are replayed to fill any gaps.
