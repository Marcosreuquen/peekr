// lib/logger.mjs
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

export function prettyBody(raw) {
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch { return raw; }
}

export function logSection(label, content, color = 'dim') {
  console.log(c('dim', `\n--- ${label} ---`));
  console.log(c(color, content));
}

export function logRequest({ id, method, url, host, timestamp, headers, body, noHeaders }) {
  console.log('\n' + DIVIDER);
  console.log(
    c('bold', `[#${id}]`) +
    c('dim', ` ${timestamp}`) +
    '  ' +
    c('cyan', `${method} ${host}${url}`)
  );
  console.log(DIVIDER);
  if (!noHeaders) logSection('Headers', JSON.stringify(headers, null, 2));
  if (body) logSection('Payload', prettyBody(body), 'yellow');
}

export function logResponse({ id, statusCode, body }) {
  const color = statusCode < 400 ? 'green' : 'red';
  logSection(`Response ${statusCode}`, prettyBody(body), color);
  console.log(DIVIDER + '\n');
}
