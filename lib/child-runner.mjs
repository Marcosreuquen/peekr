// lib/child-runner.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { INTERCEPT_TEMPLATE } from './intercept-template.mjs';

/**
 * Write the intercept loader to /tmp, spawn the child process with it injected,
 * and clean up on exit.
 *
 * @param {string[]} argv - command + args (e.g. ['npm', 'run', 'dev'])
 * @param {number} proxyPort
 * @returns {import('node:child_process').ChildProcess}
 */
export function spawnWithIntercept(argv, proxyPort) {
  const tmpFile = `/tmp/peekr-intercept-${process.pid}.mjs`;
  const loader = INTERCEPT_TEMPLATE.replace('__PROXY_PORT__', String(proxyPort));
  writeFileSync(tmpFile, loader, 'utf8');

  const existingNodeOptions = process.env.NODE_OPTIONS || '';
  const nodeOptions = `${existingNodeOptions} --import ${tmpFile}`.trim();

  const [cmd, ...args] = argv;
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      // Do NOT set HTTP_PROXY / HTTPS_PROXY — the --import patch handles
      // interception at the Node.js level. Setting proxy env vars causes
      // libraries like axios to double-redirect (they target the proxy
      // address, then the patch intercepts THAT and records the proxy
      // itself as the destination → loop).
    },
  });

  function cleanup() {
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
