// lib/child-runner.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { INTERCEPT_TEMPLATE, INTERCEPT_TEMPLATE_CJS } from './intercept-template.mjs';

const LOG_DIR = join(process.cwd(), '.peekr');
const LOG_FILE = join(LOG_DIR, 'app.log');
const MAX_BUFFER_LINES = 1000;

/** @type {Array<{stream: string, text: string, timestamp: number}>} */
const logBuffer = [];

/** @type {Set<(entry: object) => void>} */
const logListeners = new Set();

export function getLogFilePath() {
  return LOG_FILE;
}

export function getLogBuffer() {
  return logBuffer;
}

export function onLogEntry(fn) {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
}

function pushLogEntry(stream, text) {
  const entry = { stream, text, timestamp: Date.now() };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER_LINES) logBuffer.shift();
  for (const fn of logListeners) {
    try { fn(entry); } catch {}
  }
}

export function supportsNodeOptionsImport(nodeVersion = process.versions.node) {
  const [major, minor] = nodeVersion.split('.').map(Number);
  return major > 18 || (major === 18 && minor >= 19);
}

export function spawnWithIntercept(argv, proxyPort) {
  const useImport = supportsNodeOptionsImport();
  const tmpFile = `/tmp/peekr-intercept-${process.pid}.${useImport ? 'mjs' : 'cjs'}`;
  const template = useImport ? INTERCEPT_TEMPLATE : INTERCEPT_TEMPLATE_CJS;
  const loader = template.replace('__PROXY_PORT__', String(proxyPort));
  writeFileSync(tmpFile, loader, 'utf8');

  mkdirSync(LOG_DIR, { recursive: true });
  const logStream = createWriteStream(LOG_FILE, { flags: 'w' });

  const existingNodeOptions = process.env.NODE_OPTIONS || '';
  const loaderFlag = useImport ? '--import' : '--require';
  const nodeOptions = `${existingNodeOptions} ${loaderFlag} ${tmpFile}`.trim();

  const [cmd, ...args] = argv;
  const child = spawn(cmd, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    },
  });

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    logStream.write(text);
    pushLogEntry('stdout', text);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    logStream.write(text);
    pushLogEntry('stderr', text);
  });

  function cleanup() {
    logStream.end();
    try { unlinkSync(tmpFile); } catch {}
  }

  child.on('exit', cleanup);
  child.on('error', (err) => {
    console.error(`[peekr] Failed to start child process: ${err.message}`);
    cleanup();
  });
  process.once('SIGINT', () => { child.kill('SIGINT'); cleanup(); process.exit(0); });
  process.once('SIGTERM', () => { child.kill('SIGTERM'); cleanup(); process.exit(0); });

  return child;
}
