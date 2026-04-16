// lib/logger.mjs
import { appendFileSync } from 'node:fs';

export const COLORS = {
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
  cyan:  '\x1b[36m',
  yellow:'\x1b[33m',
  green: '\x1b[32m',
  red:   '\x1b[31m',
  bold:  '\x1b[1m',
};

export const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;
export const DIVIDER = '='.repeat(80);

// Optional log file — set via setLogFile(path)
let _logFile = null;
export function setLogFile(path) { _logFile = path; }

const ANSI_RE = /\x1b\[[0-9;]*m/g;
function writeLine(line) {
  console.log(line);
  if (_logFile) {
    try { appendFileSync(_logFile, line.replace(ANSI_RE, '') + '\n'); } catch {}
  }
}

export function prettyBody(raw) {
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch { return raw; }
}

export function logSection(label, content, color = 'dim') {
  writeLine(c('dim', `\n--- ${label} ---`));
  writeLine(c(color, content));
}

export function logRequest({ id, method, url, host, timestamp, headers, body, noHeaders }) {
  writeLine('\n' + DIVIDER);
  writeLine(
    c('bold', `[#${id}]`) +
    c('dim', ` ${timestamp}`) +
    '  ' +
    c('cyan', `${method} ${host}${url}`)
  );
  writeLine(DIVIDER);
  if (!noHeaders) logSection('Headers', JSON.stringify(headers, null, 2));
  if (body) logSection('Payload', prettyBody(body), 'yellow');
}

export function logResponse({ statusCode, body }) {
  const color = statusCode < 400 ? 'green' : 'red';
  logSection(`Response ${statusCode}`, prettyBody(body), color);
  writeLine(DIVIDER + '\n');
}
