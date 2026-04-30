// lib/run-command.mjs
import { createProxyServer } from './proxy-core.mjs';
import { spawnWithIntercept } from './child-runner.mjs';
import { c, printPanel, setLogFile } from './logger.mjs';
import { getArg, getAllArgs, hasFlag } from './args.mjs';
import { loadConfig, resolvePort } from './config.mjs';

export async function runCommand(argv) {
  // Split on '--' separator
  const sepIdx = argv.indexOf('--');
  if (sepIdx === -1) {
    console.error(c('red', '\nError: peekr run requires a command after --'));
    console.error('Usage: peekr run [options] -- <command>\n');
    process.exit(1);
  }

  const opts = argv.slice(0, sepIdx);
  const cmd = argv.slice(sepIdx + 1);

  if (cmd.length === 0) {
    console.error(c('red', '\nError: no command provided after --\n'));
    process.exit(1);
  }

  const target    = getArg(opts, 'target');
  const config    = loadConfig(opts);
  const port      = resolvePort(opts, config, 'port', ['proxy', 'proxyPort', 'port'], 49999);
  const noForward = hasFlag(opts, 'no-forward');
  const noHeaders = hasFlag(opts, 'no-headers');
  const mockBody  = getArg(opts, 'mock');
  const logFile   = getArg(opts, 'log-file');
  const ignore    = getAllArgs(opts, 'ignore');

  if (logFile) setLogFile(logFile);

  const { server, port: actualPort } = await createProxyServer({ port, target, noForward, noHeaders, mockBody, ignore });

  console.log('');
  printPanel({
    title: 'peekr run',
    subtitle: `${c('bold', 'HTTP Capture Proxy')} ${c('dim', 'automatic child-process interception')}`,
    color: 'cyan',
    rows: [
      ['proxy', c('cyan', `http://localhost:${actualPort}`)],
      ['scope', target ? c('green', target) : c('yellow', 'all hosts')],
      ['mode', noForward ? c('yellow', 'capture only') : c('green', 'capture + forward')],
      ['command', c('bold', cmd.join(' '))],
      ...(logFile ? [['log file', c('cyan', logFile)]] : []),
      ...(ignore.length ? [['ignoring', c('dim', ignore.join(', '))]] : []),
    ],
    footer: 'Outgoing HTTP/HTTPS calls from the child process will appear below.',
  });
  console.log('');
  console.log(`${c('dim', 'Press')} ${c('bold', 'Ctrl+C')} ${c('dim', 'to stop peekr and the child process.')}\n`);

  const child = spawnWithIntercept(cmd, actualPort);

  child.on('exit', code => {
    const exitCode = code ?? 0;
    console.log('');
    printPanel({
      title: 'session ended',
      color: exitCode === 0 ? 'green' : 'red',
      rows: [
        ['command', c('bold', cmd.join(' '))],
        ['exit code', exitCode === 0 ? c('green', exitCode) : c('red', exitCode)],
      ],
    });
    server.close(() => process.exit(exitCode));
  });
}
