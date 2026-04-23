# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-04-19

### Added

- **Modify action** — replaces mock/transform with a unified `modify` action that mutates request and/or response headers and body
  - `req.setBody`, `req.setHeaders`, `req.removeHeaders` — mutate the outgoing request
  - `res.setBody`, `res.setHeaders`, `res.removeHeaders` — mutate the response returned to the client
  - `noForward` flag — skip the upstream entirely and return the modified response directly
  - Header keys are normalized to lowercase on `setHeaders` to avoid duplicate/casing issues
- **Breakpoint system** — pause requests mid-flight for manual inspection and resume
  - `breakpoint` rule action with `phase` field (`request`, `response`, `both`)
  - Breakpoints panel in the dashboard showing all pending pauses
  - REST endpoint `POST /api/breakpoints/:id/resolve` to resume or abort
  - SSE `breakpoint` event broadcasts new pauses to connected clients
- **Dashboard breakpoints panel** — dedicated panel (▮ toggle) listing pending breakpoints with Resume/Abort controls
- **`updateRule` API** — partial-update endpoint for modifying existing rules in place
- **Expanded rules form** — rules drawer now renders full edit cards with action-specific fields visible inline
- **Host filter dropdown** — top bar now has a Host filter populated from captured traffic
- **Press Enter to open dashboard** — `peekr ui` prompts to open the dashboard URL on Enter key

### Changed

- Rules engine: `mock` and `transform` actions replaced by `modify`; `phase` guard removed in favour of direction-based matching
- Context menu: "Mock this host" replaced by "Modify this host"
- Proxy core and reverse proxy: transform/breakpoint pipeline integrated; console output suppressed in UI mode
- Rules REST API base URL changed from `:3000/api/rules` to `:49997/api/rules` (dashboard port)
- Log drawer filter buttons relabelled: **Raw / INFO / WARN / ERROR** (was ALL / INFO / WARN / ERR)
- Rule match badge **MCK** renamed to **MOD**

### Fixed

- Modify pipeline: header keys normalized to lowercase on `setHeaders`
- Rules engine: `modifyConfig`/`timeoutMs` not reset on partial `updateRule` calls
- UI: context menu onclick handlers use `data-*` attributes and escape user content to prevent XSS
- UI: breakpoint resolve endpoint handles empty body gracefully
- Proxy core: async callbacks wrapped in try/catch; mock/edit handling uses `else-if` to avoid double-match
- Reverse proxy: `console.error` suppressed in UI mode to keep dashboard output clean

## [0.1.0] - 2026-04-17

### Added

- **Proxy mode** (`peekr --target <host>`) — standalone HTTP capture proxy with optional forwarding
- **Auto-intercept mode** (`peekr run -- <command>`) — spawns child process with monkey-patched HTTP/HTTPS
- **Live web dashboard** (`peekr ui`) — real-time request table with detail drawer
  - Dark theme, sortable columns, method/status/direction filters
  - JSON syntax highlighting for headers, payloads, and responses
  - 3-state detail drawer (collapsed / medium / expanded)
- **Dynamic rules engine** — block or mock requests by host/method/path via context menu or rules drawer
  - REST API for rules management (GET/POST/DELETE `/api/rules`)
  - SSE broadcast on rule changes
- **Reverse proxy** for incoming traffic capture with timing data (durationMs, responseSize, resHeaders)
- **Child process log decoupling** — pipes stdout/stderr to `.peekr/app.log` + in-memory buffer + SSE broadcast
- **`peekr logs`** command — follow app logs from peekr-managed child processes
- Loop detection in proxy core (508 response)
- Double-patch guard in intercept template
