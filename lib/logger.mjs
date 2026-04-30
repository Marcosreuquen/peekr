// lib/logger.mjs
import { appendFileSync } from 'node:fs';

export const COLORS = {
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
  cyan:  '\x1b[36m',
  blue:  '\x1b[34m',
  magenta:'\x1b[35m',
  yellow:'\x1b[33m',
  green: '\x1b[32m',
  red:   '\x1b[31m',
  bold:  '\x1b[1m',
};

export const c = (color, text) => `${COLORS[color] || ''}${text}${COLORS.reset}`;
export const DIVIDER = '='.repeat(80);

// Optional log file — set via setLogFile(path)
let _logFile = null;
export function setLogFile(path) { _logFile = path; }

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = text => String(text).replace(ANSI_RE, '');

function writeLine(line) {
  console.log(line);
  if (_logFile) {
    try { appendFileSync(_logFile, stripAnsi(line) + '\n'); } catch {}
  }
}

function visibleLength(text) {
  return stripAnsi(text).length;
}

function padRight(text, width) {
  const padding = Math.max(0, width - visibleLength(text));
  return `${text}${' '.repeat(padding)}`;
}

function truncateVisible(text, width) {
  const raw = stripAnsi(text);
  if (raw.length <= width) return text;
  return `${raw.slice(0, Math.max(0, width - 1))}…`;
}

export function terminalWidth(max = 92) {
  return Math.min(max, Math.max(64, process.stdout.columns || 88));
}

export function panel({ title, subtitle, rows = [], footer, color = 'cyan', width = terminalWidth() }) {
  const inner = width - 4;
  const border = c('dim', '─'.repeat(width - 2));
  const topTitle = title ? ` ${stripAnsi(title)} ` : '';
  const topRule = Math.max(0, width - 2 - topTitle.length);
  const lines = [];

  lines.push(c('dim', `┌${topTitle ? c(color, topTitle) : ''}${'─'.repeat(topRule)}┐`));
  if (subtitle) {
    lines.push(`${c('dim', '│')} ${padRight(truncateVisible(subtitle, inner), inner)} ${c('dim', '│')}`);
    lines.push(`${c('dim', '├')}${border}${c('dim', '┤')}`);
  }
  for (const row of rows) {
    if (row === 'divider') {
      lines.push(`${c('dim', '├')}${border}${c('dim', '┤')}`);
      continue;
    }
    const [label, value = ''] = row;
    const key = c('dim', `${label}`.padEnd(13));
    const available = inner - 15;
    const val = truncateVisible(String(value), available);
    lines.push(`${c('dim', '│')} ${key} ${padRight(val, available)} ${c('dim', '│')}`);
  }
  if (footer) {
    lines.push(`${c('dim', '├')}${border}${c('dim', '┤')}`);
    lines.push(`${c('dim', '│')} ${padRight(truncateVisible(footer, inner), inner)} ${c('dim', '│')}`);
  }
  lines.push(c('dim', `└${'─'.repeat(width - 2)}┘`));

  return lines.join('\n');
}

export function printPanel(options) {
  for (const line of panel(options).split('\n')) writeLine(line);
}

export function prettyBody(raw) {
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch { return raw; }
}

export function logSection(label, content, color = 'dim') {
  writeLine(c('dim', `\n  ${label}`));
  writeLine(c('dim', `  ${'─'.repeat(Math.min(46, Math.max(12, label.length)))}`));
  for (const line of String(content).split('\n')) {
    writeLine(`  ${c(color, line)}`);
  }
}

export function logRequest({ id, method, url, host, timestamp, headers, body, noHeaders }) {
  const destination = `${host}${url}`;
  const methodColor = method === 'GET' ? 'cyan' : method === 'POST' ? 'green' : method === 'DELETE' ? 'red' : 'yellow';
  writeLine('');
  printPanel({
    title: `OUT #${id}`,
    subtitle: `${c(methodColor, c('bold', method))} ${destination}`,
    color: methodColor,
    rows: [
      ['time', timestamp],
      ['destination', destination],
      ['headers', noHeaders ? c('dim', 'hidden') : Object.keys(headers || {}).length],
      ['payload', body ? `${Buffer.byteLength(body)} bytes` : c('dim', 'empty')],
    ],
  });
  if (!noHeaders) logSection('Headers', JSON.stringify(headers, null, 2));
  if (body) logSection('Payload', prettyBody(body), 'yellow');
}

export function logResponse({ statusCode, body }) {
  const color = statusCode < 400 ? 'green' : 'red';
  const statusText = statusCode < 400 ? 'OK' : 'ERROR';
  printPanel({
    title: `RESPONSE ${statusCode}`,
    subtitle: `${c(color, c('bold', statusText))} ${Buffer.byteLength(body || '')} bytes`,
    color,
    rows: [
      ['status', c(color, statusCode)],
      ['body', body ? `${Buffer.byteLength(body)} bytes` : c('dim', 'empty')],
    ],
  });
  if (body) logSection(`Body`, prettyBody(body), color);
  writeLine('');
}
