#!/usr/bin/env node

import { getArg, hasFlag } from '../lib/args.mjs';

const subcommand = process.argv[2];

if (subcommand === 'run') {
  const { runCommand } = await import('../lib/run-command.mjs');
  await runCommand(process.argv.slice(3));
} else if (subcommand === 'ui') {
  try {
    const { uiCommand } = await import('../lib/ui-command.mjs');
    await uiCommand(process.argv.slice(3));
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('\npeekr ui is not yet available in this version.\n');
      process.exit(1);
    }
    throw err;
  }
} else {
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

  const { c } = await import('../lib/logger.mjs');
  const { createProxyServer } = await import('../lib/proxy-core.mjs');

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

  const TARGET_HOST = getArg(args, "target");
  const PORT = parseInt(getArg(args, "port") || "49999", 10);
  const NO_FORWARD = hasFlag(args, "no-forward");
  const NO_HEADERS = hasFlag(args, "no-headers");
  const MOCK_BODY = getArg(args, "mock");

  if (!TARGET_HOST && !NO_FORWARD) {
    console.error(
      "\nError: --target <host> is required unless --no-forward is set.",
    );
    console.error("Run peekr --help for usage.\n");
    process.exit(1);
  }

  // ── Server ────────────────────────────────────────────────────────────────────
  const { port: actualPort } = await createProxyServer({
    port: PORT,
    target: TARGET_HOST,
    noForward: NO_FORWARD,
    noHeaders: NO_HEADERS,
    mockBody: MOCK_BODY,
  });

  console.log(`\n${c('bold', 'peekr')} — HTTP Capture Proxy`);
  console.log(c('dim', '─'.repeat(40)));
  console.log(`Listening on  ${c('cyan', `http://localhost:${actualPort}`)}`);
  if (NO_FORWARD) {
    console.log(`Mode          ${c('yellow', 'CAPTURE ONLY')} (no forwarding)`);
  } else {
    console.log(`Forwarding to ${c('green', `https://${TARGET_HOST}`)}`);
  }
  if (NO_HEADERS) console.log(`Headers       ${c('dim', 'hidden (--no-headers)')}`);
  console.log(c('dim', '─'.repeat(40)));
  console.log('Waiting for requests...\n');
}
