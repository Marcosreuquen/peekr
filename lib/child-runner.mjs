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
      HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
      HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
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
