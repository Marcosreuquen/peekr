# Changelog

All notable changes to this project will be documented in this file.

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
