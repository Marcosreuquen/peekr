// lib/logs-command.mjs
import { createReadStream, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';

const LOG_FILE = join(process.cwd(), '.peekr', 'app.log');

export function logsCommand(argv) {
  const hasClear = argv.includes('--clear');

  if (hasClear) {
    try {
      truncateSync(LOG_FILE, 0);
      console.log('Log file cleared.');
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log('No log file found.');
      } else {
        console.error(`Error clearing log file: ${err.message}`);
      }
    }
    process.exit(0);
  }

  let offset = 0;
  try {
    statSync(LOG_FILE);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No log file found. Start your app with `peekr run` or `peekr ui` first.');
      console.log(`Expected: ${LOG_FILE}`);
      process.exit(1);
    }
    throw err;
  }

  console.log(`Following ${LOG_FILE} (Ctrl+C to stop)\n`);

  function poll() {
    try {
      const stat = statSync(LOG_FILE);
      if (stat.size > offset) {
        const stream = createReadStream(LOG_FILE, { start: offset, encoding: 'utf8' });
        stream.on('data', (chunk) => process.stdout.write(chunk));
        stream.on('end', () => { offset = stat.size; });
      }
    } catch {}
  }

  poll();
  const interval = setInterval(poll, 200);

  process.on('SIGINT', () => {
    clearInterval(interval);
    process.exit(0);
  });
}
