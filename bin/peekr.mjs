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

import http from "node:http";
import https from "node:https";

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

// ── Helpers ───────────────────────────────────────────────────────────────────
let requestCounter = 0;
const DIVIDER = "=".repeat(80);

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

function prettyBody(raw) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function logSection(label, content, color = "dim") {
  console.log(c("dim", `\n--- ${label} ---`));
  console.log(c(color, content));
}

function logRequest(id, method, url, timestamp, headers, body) {
  console.log("\n" + DIVIDER);
  console.log(
    c("bold", `[#${id}]`) +
      c("dim", ` ${timestamp}`) +
      "  " +
      c("cyan", `${method} ${url}`),
  );
  console.log(DIVIDER);

  if (!NO_HEADERS) {
    logSection("Headers", JSON.stringify(headers, null, 2));
  }
  if (body) {
    logSection("Payload", prettyBody(body), "yellow");
  }
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const chunks = [];
  const id = ++requestCounter;

  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString();
    const timestamp = new Date().toISOString();

    logRequest(id, req.method, req.url, timestamp, req.headers, body);

    // ── No-forward mode ──────────────────────────────────────────────────
    if (NO_FORWARD) {
      let mockResponse;
      if (MOCK_BODY) {
        try {
          mockResponse = JSON.parse(MOCK_BODY);
        } catch {
          console.error(
            c(
              "red",
              `[#${id}] --mock value is not valid JSON, using empty object`,
            ),
          );
          mockResponse = {};
        }
      } else {
        mockResponse = {};
      }

      console.log(c("dim", `\n[#${id}] --no-forward: returning mock 200`));
      console.log(DIVIDER + "\n");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(mockResponse));
      return;
    }

    // ── Forward to real upstream ─────────────────────────────────────────
    const forwardReq = https.request(
      {
        hostname: TARGET_HOST,
        port: 443,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: TARGET_HOST },
      },
      (forwardRes) => {
        const forwardChunks = [];
        forwardRes.on("data", (c) => forwardChunks.push(c));
        forwardRes.on("end", () => {
          const forwardBody = Buffer.concat(forwardChunks).toString();
          const statusColor = forwardRes.statusCode < 400 ? "green" : "red";
          logSection(
            `Response ${forwardRes.statusCode}`,
            prettyBody(forwardBody),
            statusColor,
          );
          console.log(DIVIDER + "\n");

          res.writeHead(forwardRes.statusCode, forwardRes.headers);
          res.end(forwardBody);
        });
      },
    );

    forwardReq.on("error", (err) => {
      console.error(c("red", `\n[#${id}] FORWARD ERROR: ${err.message}`));
      console.log(DIVIDER + "\n");
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "proxy forward failed", detail: err.message }),
      );
    });

    forwardReq.write(body);
    forwardReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`\n${c("bold", "peekr")} — HTTP Capture Proxy`);
  console.log(c("dim", "─".repeat(40)));
  console.log(`Listening on  ${c("cyan", `http://localhost:${PORT}`)}`);
  if (NO_FORWARD) {
    console.log(`Mode          ${c("yellow", "CAPTURE ONLY")} (no forwarding)`);
  } else {
    console.log(`Forwarding to ${c("green", `https://${TARGET_HOST}`)}`);
  }
  if (NO_HEADERS) {
    console.log(`Headers       ${c("dim", "hidden (--no-headers)")}`);
  }
  console.log(c("dim", "─".repeat(40)));
  console.log("Waiting for requests...\n");
});
