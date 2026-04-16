// lib/run-command.mjs
import { createProxyServer } from './proxy-core.mjs';
import { spawnWithIntercept } from './child-runner.mjs';
import { c } from './logger.mjs';
import { getArg, hasFlag } from './args.mjs';

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
  const port      = parseInt(getArg(opts, 'port') || '49999', 10);
  const noForward = hasFlag(opts, 'no-forward');
  const noHeaders = hasFlag(opts, 'no-headers');
  const mockBody  = getArg(opts, 'mock');

  const { server, port: actualPort } = await createProxyServer({ port, target, noForward, noHeaders, mockBody });

  console.log(`\n${c('bold', 'peekr run')} — HTTP Capture Proxy`);
  console.log(c('dim', '─'.repeat(40)));
  console.log(`Proxy on      ${c('cyan', `http://localhost:${actualPort}`)}`);
  console.log(`Intercepting  ${target ? c('green', target) : c('yellow', 'all hosts')}`);
  if (noForward) console.log(`Mode          ${c('yellow', 'CAPTURE ONLY')} (no forwarding)`);
  console.log(`Command       ${c('dim', cmd.join(' '))}`);
  console.log(c('dim', '─'.repeat(40)) + '\n');

  const child = spawnWithIntercept(cmd, actualPort);

  child.on('exit', code => {
    server.close(() => process.exit(code ?? 0));
  });
}
