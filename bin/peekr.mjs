#!/usr/bin/env node

import { getArg, hasFlag } from '../lib/args.mjs';
import { loadConfig, resolvePort } from '../lib/config.mjs';

const subcommand = process.argv[2];

if (subcommand === 'run') {
  const args = process.argv.slice(3);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`
peekr run — Spawn your app with automatic HTTP interception

Usage:
  peekr run [options] -- <command>

How it works:
  peekr starts your app as a child process and monkey-patches node:http and
  node:https so ALL outgoing HTTP/HTTPS calls are automatically intercepted
  and logged. No changes to your app or .env files are needed.
  Works with Axios, fetch, undici, got, and any Node.js HTTP client.

Options:
  --port <port>      Outgoing proxy port                        (default: 49999)
  --config <path>    Read ports from a JSON config file
  --target <host>    Only log requests to this host; pass rest through
  --no-forward       Capture only — return mock 200, don't forward
  --no-headers       Omit headers from log output
  --mock <json>      Custom JSON body for --no-forward mode
  --log-file <path>  Also write logs to this file (survives terminal clears)
  -h, --help         Show this help

Examples:
  peekr run -- node server.mjs
  peekr run -- npm run start:dev
  peekr run --target api.example.com -- npm run start:dev
  peekr run --no-forward -- node server.mjs
`);
    process.exit(0);
  }
  const { runCommand } = await import('../lib/run-command.mjs');
  await runCommand(args);
} else if (subcommand === 'ui') {
  const args = process.argv.slice(3);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`
peekr ui — Live web dashboard for HTTP traffic (incoming + outgoing)

Usage:
  peekr ui [options]
  peekr ui [options] -- <command>

Traffic capture:
  INCOMING (IN)
    peekr starts a reverse proxy in front of your app. To capture incoming
    requests, send them to the reverse proxy port instead of your app directly:

      Your client  →  peekr reverse proxy (:49998)  →  your app (:3000)

    Change your test/client base URL to http://localhost:49998

  OUTGOING (OUT)
    Only captured when your app is started through peekr (using -- <command>).
    peekr injects a monkey-patch that intercepts all outgoing HTTP/HTTPS calls.
    Works with Axios, fetch, undici, got, and any Node.js HTTP client.

    If your app is already running separately, outgoing traffic is NOT captured.
    Use: peekr ui --app-port 3000 -- npm run start:dev

Options:
  --app-port <port>      Port your app listens on              (default: 3000)
  --port <port>          Outgoing proxy port                   (default: 49999)
  --reverse-port <port>  Reverse proxy port (send IN traffic here) (default: 49998)
  --ui-port <port>       Dashboard port                        (default: 49997)
  --config <path>        Read ports from a JSON config file
  --target <host>        Only log outgoing requests to this host
  --no-forward           Capture only — return mock 200
  --no-headers           Omit headers from log output
  --mock <json>          Custom JSON body for --no-forward mode
  --log-file <path>      Also write logs to this file (survives terminal clears)
  -h, --help             Show this help

Examples:
  # App already running on :3000 — attach dashboard, send requests to :49998
  peekr ui --app-port 3000

  # peekr starts the app — captures both IN and OUT traffic
  peekr ui --app-port 3000 -- npm run start:dev

  # NestJS example
  peekr ui --app-port 3000 -- npx ts-node -r tsconfig-paths/register src/main.ts
`);
    process.exit(0);
  }
  try {
    const { uiCommand } = await import('../lib/ui-command.mjs');
    await uiCommand(args);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('\npeekr ui is not yet available in this version.\n');
      process.exit(1);
    }
    throw err;
  }
} else if (subcommand === 'logs') {
  const args = process.argv.slice(3);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`
peekr logs — Follow app logs from peekr-managed child processes

Usage:
  peekr logs [options]

Options:
  --clear    Clear the log file and exit
  -h, --help Show this help

The log file is located at .peekr/app.log in the current directory.
`);
    process.exit(0);
  }
  const { logsCommand } = await import('../lib/logs-command.mjs');
  logsCommand(args);
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
   *   --port <port>     Local port to listen on          (default: 49999)
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
peekr v0.3.0 — HTTP Capture Proxy

Usage:
  peekr --target <host> [options]          Proxy mode (manual .env change)
  peekr run [options] -- <command>         Auto-intercept mode (no .env change needed)
  peekr ui [options] [-- <command>]        Live web dashboard

Subcommands:
  run   Spawn your app with all outgoing HTTP/HTTPS automatically intercepted.
        No need to change .env or base URLs. Works with any Node.js HTTP client.
        Run: peekr run --help

  ui    Start a live web dashboard showing incoming and outgoing HTTP traffic.
        Incoming: send requests to the reverse proxy port (not your app directly).
        Outgoing: only captured if app is started via peekr ui -- <command>.
        Run: peekr ui --help

  logs  Follow app logs from peekr-managed child processes.
        Run: peekr logs --help

Proxy mode options (backward compat):
  --target <host>   Upstream HTTPS hostname to forward requests to
  --port <port>     Local port to listen on (default: 49999)
  --config <path>   Read ports from a JSON config file
  --no-forward      Capture only — don't forward, return a mock 200
  --no-headers      Omit request/response headers from log output
  --mock <json>     Custom JSON body to return in --no-forward mode
  -h, --help        Show this help

Examples:
  peekr run -- npm run start:dev
  peekr ui --app-port 3000 -- npm run start:dev
  peekr --target api.example.com
  peekr --no-forward --mock '{"ok":true}'
`);
    process.exit(0);
  }

  const TARGET_HOST = getArg(args, "target");
  const config = loadConfig(args);
  const PORT = resolvePort(args, config, "port", ["proxy", "proxyPort", "port"], 49999);
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
