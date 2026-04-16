// lib/ui-command.mjs
import { createProxyServer } from './proxy-core.mjs';
import { createReverseProxy } from './reverse-proxy.mjs';
import { createUiServer } from './ui-server.mjs';
import { spawnWithIntercept } from './child-runner.mjs';
import { c } from './logger.mjs';
import { getArg, hasFlag } from './args.mjs';

export async function uiCommand(argv) {
  const sepIdx = argv.indexOf('--');
  const opts = sepIdx !== -1 ? argv.slice(0, sepIdx) : argv;
  const cmd  = sepIdx !== -1 ? argv.slice(sepIdx + 1) : null;

  const appPort     = parseInt(getArg(opts, 'app-port')     || '3000', 10);
  const port        = parseInt(getArg(opts, 'port')         || '9999', 10);
  const reversePort = parseInt(getArg(opts, 'reverse-port') || '8888', 10);
  const uiPort      = parseInt(getArg(opts, 'ui-port')      || '4000', 10);
  const target      = getArg(opts, 'target');
  const noForward   = hasFlag(opts, 'no-forward');
  const noHeaders   = hasFlag(opts, 'no-headers');
  const mockBody    = getArg(opts, 'mock');

  const { broadcast } = await createUiServer({ port: uiPort });
  const onRequest = record => broadcast(record);

  await createProxyServer({ port, target, noForward, noHeaders, mockBody, onRequest });
  await createReverseProxy({ port: reversePort, appPort, noHeaders, onRequest });

  console.log(`\n${c('bold', 'peekr ui')} — HTTP Capture Dashboard`);
  console.log(c('dim', '─'.repeat(40)));
  console.log(`Dashboard     ${c('cyan', `http://localhost:${uiPort}`)}`);
  console.log(`Reverse proxy ${c('cyan', `http://localhost:${reversePort}`)} → app :${appPort}`);
  console.log(`Outgoing proxy${c('cyan', ` http://localhost:${port}`)}`);
  console.log(`Intercepting  ${target ? c('green', target) : c('yellow', 'all hosts')}`);
  if (noForward) console.log(`Mode          ${c('yellow', 'CAPTURE ONLY')}`);
  console.log(c('dim', '─'.repeat(40)) + '\n');

  if (cmd && cmd.length > 0) {
    const child = spawnWithIntercept(cmd, port);
    child.on('exit', code => process.exit(code ?? 0));
  }
}
