import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

function openssl(args) {
  try { execFileSync('openssl', args, { stdio: 'pipe' }); }
  catch (err) { throw new Error(`OpenSSL failed: ${err.stderr?.toString().trim() || err.message}`); }
}

function withLock(path, fn) {
  const deadline = Date.now() + 15000;
  for (;;) {
    try { mkdirSync(path, { mode: 0o700 }); break; }
    catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for certificate lock ${path}; remove it only after all Peekr processes have stopped`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try { return fn(); } finally { rmdirSync(path); }
}

export function createWorkspaceCA(dir = join(homedir(), '.peekr', 'ca')) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = join(dir, 'root-key.pem');
  const cert = join(dir, 'root-cert.pem');
  withLock(join(dir, '.root.lock'), () => {
    if (existsSync(key) !== existsSync(cert)) throw new Error(`Incomplete Peekr CA in ${dir}`);
    if (!existsSync(key)) {
      openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '3650', '-subj', '/CN=Peekr Local CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
    }
    chmodSync(key, 0o600);
  });
  const cache = new Map();
  function certificate(host) {
    if (!isIP(host) && (!/^[a-zA-Z0-9.-]{1,253}$/.test(host) || host.startsWith('.') || host.endsWith('.'))) throw new Error('Invalid TLS hostname');
    if (cache.has(host)) return cache.get(host);
    const id = createHash('sha256').update(host).digest('hex');
    const leafKey = join(dir, `${id}-key.pem`);
    const leafCsr = join(dir, `${id}.csr`);
    const leafCert = join(dir, `${id}-cert.pem`);
    const ext = join(dir, `${id}.ext`);
    const result = withLock(join(dir, `.${id}.lock`), () => {
      let valid = existsSync(leafKey) && existsSync(leafCert);
      if (valid) {
        try {
          execFileSync('openssl', ['x509', '-checkend', '86400', '-noout', '-in', leafCert], { stdio: 'ignore' });
          execFileSync('openssl', ['verify', '-CAfile', cert, leafCert], { stdio: 'ignore' });
        } catch { valid = false; }
      }
      if (!valid) {
        writeFileSync(ext, `subjectAltName=${isIP(host) ? 'IP' : 'DNS'}:${host}\nextendedKeyUsage=serverAuth\n`, { mode: 0o600 });
        openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', leafKey, '-out', leafCsr, '-subj', '/CN=Peekr']);
        chmodSync(leafKey, 0o600);
        openssl(['x509', '-req', '-in', leafCsr, '-CA', cert, '-CAkey', key, '-set_serial', `0x${randomBytes(16).toString('hex')}`, '-out', leafCert, '-days', '30', '-extfile', ext]);
        try { unlinkSync(leafCsr); unlinkSync(ext); } catch {}
      }
      chmodSync(leafKey, 0o600);
      return { key: readFileSync(leafKey), cert: readFileSync(leafCert) };
    });
    cache.set(host, result);
    return result;
  }
  return { certPath: cert, certificate };
}
