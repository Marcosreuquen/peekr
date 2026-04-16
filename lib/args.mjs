// lib/args.mjs
import net from 'node:net';

export function getArg(args, name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

export const hasFlag = (args, name) => args.includes(`--${name}`);

/**
 * Listen on `port`, auto-incrementing if EADDRINUSE (up to 20 attempts).
 * Returns the actual port bound.
 *
 * @param {net.Server} server
 * @param {number} port
 * @returns {Promise<number>}
 */
export function listenOnAvailablePort(server, port) {
  return new Promise((resolve, reject) => {
    let current = port;
    const tryListen = () => {
      server.once('error', err => {
        if (err.code === 'EADDRINUSE' && current - port < 20) {
          current++;
          tryListen();
        } else {
          reject(err);
        }
      });
      server.listen(current, () => resolve(current));
    };
    tryListen();
  });
}
