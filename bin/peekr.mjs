#!/usr/bin/env node
/**
 * peekr — HTTP Capture Proxy
 *
 * Intercepts outgoing HTTP calls from any app, logs the full
 * request/response cycle, and optionally forwards to the real upstream.
 *
 * Zero dependencies. Node.js >= 18 required.
 *
 * Usage:
 *   peekr --target <host> [--port <port>] [--no-forward] [--no-headers]
 *
 * Options:
 *   --target <host>   Upstream HTTPS hostname to forward to
 *   --port <port>     Local port to listen on          (default: 9999)
 *   --no-forward      Capture only, return mock 200    (default: false)
 *   --no-headers      Omit headers from log output     (default: false)
 *   --mock <json>     Custom mock response body for --no-forward mode
 *   -h, --help        Show this help message
 */

import { c } from '../lib/logger.mjs';
import { createProxyServer } from '../lib/proxy-core.mjs';

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
peekr v0.1.0 — HTTP Capture Proxy

Usage:
  peekr --target <host> [options]
  peekr --no-forward [options]

Options:
  --target <host>   Upstream HTTPS hostname to forward to
  --port <port>     Local port to listen on (default: 9999)
  --no-forward      Capture only — don't forward, return a mock 200
  --no-headers      Omit request/response headers from log output
  --mock <json>     Custom JSON body to return in --no-forward mode
  -h, --help        Show this help

Examples:
  peekr --target api.example.com
  peekr --target api.example.com --port 8080
  peekr --no-forward
  peekr --no-forward --mock '{"ok":true}'
`);
  process.exit(0);
}

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
const hasFlag = (name) => args.includes(`--${name}`);

const TARGET_HOST = getArg("target");
const PORT = parseInt(getArg("port") || "9999", 10);
const NO_FORWARD = hasFlag("no-forward");
const NO_HEADERS = hasFlag("no-headers");
const MOCK_BODY = getArg("mock");

if (!TARGET_HOST && !NO_FORWARD) {
  console.error(
    "\nError: --target <host> is required unless --no-forward is set.",
  );
  console.error("Run peekr --help for usage.\n");
  process.exit(1);
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = await createProxyServer({
  port: PORT,
  target: TARGET_HOST,
  noForward: NO_FORWARD,
  noHeaders: NO_HEADERS,
  mockBody: MOCK_BODY,
});

console.log(`\n${c('bold', 'peekr')} — HTTP Capture Proxy`);
console.log(c('dim', '─'.repeat(40)));
console.log(`Listening on  ${c('cyan', `http://localhost:${PORT}`)}`);
if (NO_FORWARD) {
  console.log(`Mode          ${c('yellow', 'CAPTURE ONLY')} (no forwarding)`);
} else {
  console.log(`Forwarding to ${c('green', `https://${TARGET_HOST}`)}`);
}
if (NO_HEADERS) console.log(`Headers       ${c('dim', 'hidden (--no-headers)')}`);
console.log(c('dim', '─'.repeat(40)));
console.log('Waiting for requests...\n');
