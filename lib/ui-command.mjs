// lib/ui-command.mjs
import { exec } from 'node:child_process';
import { createProxyServer } from './proxy-core.mjs';
import { createReverseProxy } from './reverse-proxy.mjs';
import { createUiServer } from './ui-server.mjs';
import { spawnWithIntercept, getLogBuffer, onLogEntry } from './child-runner.mjs';
import { c, setLogFile } from './logger.mjs';
import { getArg, getAllArgs, hasFlag } from './args.mjs';
import * as rulesEngine from './rules-engine.mjs';

export async function uiCommand(argv) {
  const sepIdx = argv.indexOf('--');
  const opts = sepIdx !== -1 ? argv.slice(0, sepIdx) : argv;
  const cmd  = sepIdx !== -1 ? argv.slice(sepIdx + 1) : null;

  const appPort     = parseInt(getArg(opts, 'app-port')     || '3000', 10);
  const port        = parseInt(getArg(opts, 'port')         || '49999', 10);
  const reversePort = parseInt(getArg(opts, 'reverse-port') || '49998', 10);
  const uiPort      = parseInt(getArg(opts, 'ui-port')      || '49997', 10);
  const target      = getArg(opts, 'target');
  const noForward   = hasFlag(opts, 'no-forward');
  const noHeaders   = hasFlag(opts, 'no-headers');
  const mockBody    = getArg(opts, 'mock');
  const logFile     = getArg(opts, 'log-file');
  const ignore      = getAllArgs(opts, 'ignore');

  if (logFile) setLogFile(logFile);

  const willSpawn = cmd && cmd.length > 0;
  const uiOpts = { port: uiPort, rulesEngine };
  if (willSpawn) {
    uiOpts.getLogBuffer = () => getLogBuffer();
    uiOpts.onLogSubscribe = (fn) => onLogEntry(fn);
  }

  const { broadcast, port: actualUiPort } = await createUiServer(uiOpts);
  const onRequest = record => broadcast(record);

  const { port: actualProxyPort }   = await createProxyServer({ port, target, noForward, noHeaders, mockBody, onRequest, ignore });
  const { port: actualReversePort } = await createReverseProxy({ port: reversePort, appPort, noHeaders, onRequest });

  console.log(`\n${c('bold', 'peekr ui')} — HTTP Capture Dashboard`);
  console.log(c('dim', '─'.repeat(40)));
  console.log(`Dashboard     ${c('cyan', `http://localhost:${actualUiPort}`)}`);
  console.log(`Reverse proxy ${c('cyan', `http://localhost:${actualReversePort}`)} → app :${appPort}`);
  console.log(`Outgoing proxy${c('cyan', ` http://localhost:${actualProxyPort}`)}`);
  console.log(`Intercepting  ${target ? c('green', target) : c('yellow', 'all hosts')}`);
  if (noForward) console.log(`Mode          ${c('yellow', 'CAPTURE ONLY')}`);
  console.log(c('dim', '─'.repeat(40)));
  console.log('');
  console.log(c('bold', 'How to capture traffic:'));
  console.log('');
  if (willSpawn) {
    console.log(`  ${c('green', '✔')} Outgoing (OUT): automatic — app was started by peekr`);
  } else {
    console.log(`  ${c('yellow', '!')} Outgoing (OUT): not captured`);
    console.log(`    To capture outgoing calls, start your app through peekr:`);
    console.log(`    ${c('dim', `peekr ui --app-port ${appPort} -- <your start command>`)}`);
  }
  console.log(`  ${c('yellow', '!')} Incoming (IN):  send requests to the reverse proxy, not your app directly:`);
  console.log(`    ${c('cyan', `http://localhost:${actualReversePort}`)} ${c('dim', `→ forwards to your app on :${appPort}`)}`);
  console.log('');
  console.log(c('dim', '─'.repeat(40)) + '\n');

  // ── Press Enter to open dashboard ──
  const dashUrl = `http://localhost:${actualUiPort}`;
  console.log(`Press ${c('bold', 'Enter')} to open the dashboard in your browser`);
  console.log('');

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key) => {
      // Ctrl+C = '\u0003'
      if (key === '\u0003') { process.exit(0); }
      // Only open browser on Enter key ('\r' or '\n')
      if (key !== '\r' && key !== '\n') { return; }
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      exec(`${opener} "${dashUrl}"`);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    });
  }

  if (willSpawn) {
    const child = spawnWithIntercept(cmd, actualProxyPort);
    child.on('exit', code => process.exit(code ?? 0));
  }
}
