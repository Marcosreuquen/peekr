import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, '../..');
const children = new Set();
let stopping = false;

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
  children.add(child);
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${command} exited (${signal || code})`);
      stop(1);
    }
  });
  child.once('error', err => { console.error(err.message); stop(1); });
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  if (!children.size) process.exit(code);
  else {
    Promise.all([...children].map(child => new Promise(resolve => child.once('exit', resolve))))
      .then(() => process.exit(code));
    setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 2000).unref();
  }
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

try {
  const workspacePort = await freePort();
  const appPorts = [];
  while (appPorts.length < 4) {
    const port = await freePort();
    if (port !== workspacePort && !appPorts.includes(port)) appPorts.push(port);
  }
  const workspaceUrl = `http://127.0.0.1:${workspacePort}`;
  const workspaceName = `demo-${randomBytes(4).toString('hex')}`;
  start(process.execPath, [join(root, 'bin/peekr.mjs'), 'workspace', 'start', '--name', workspaceName, '--port', String(workspacePort)]);
  await waitFor(`${workspaceUrl}/workspace`);

  const services = [];
  for (const [index, name] of ['gateway-node', 'orders-node', 'inventory-python'].entries()) {
    const response = await fetch(`${workspaceUrl}/services`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, appPort: appPorts[index] }),
    });
    const service = await response.json();
    if (!response.ok) throw new Error(service.error);
    services.push(service);
  }
  start(process.execPath, [join(dir, 'external-service.mjs')], { env: { ...process.env, APP_PORT: String(appPorts[3]) } });
  for (let i = 0; i < services.length; i++) {
    const service = services[i];
    const env = { ...process.env, SERVICE_NAME: service.name, APP_PORT: String(service.appPort) };
    if (i < 2) {
      env.http_proxy = `http://127.0.0.1:${service.proxyPort}`;
      env.NEXT_URL = `http://127.0.0.1:${services[i + 1].reversePort}/flow`;
      env.GATEWAY_URL = `http://127.0.0.1:${services[0].reversePort}/flow`;
      env.INVENTORY_URL = `http://127.0.0.1:${services[2].reversePort}/flow`;
      env.EXTERNAL_URL = `http://127.0.0.1:${appPorts[3]}/catalog`;
      start(process.execPath, [join(dir, 'node-service.mjs')], { env });
    } else start('python3', [join(dir, 'python-service.py')], { env });
  }
  await Promise.all([...services.map(service => waitFor(`http://127.0.0.1:${service.appPort}/health`)), waitFor(`http://127.0.0.1:${appPorts[3]}/health`)]);
  console.log(`\nDashboard: ${workspaceUrl}`);
  console.log(`Start flow: http://127.0.0.1:${services[0].reversePort}/flow`);
  console.log(`Circular + external: http://127.0.0.1:${services[0].reversePort}/flow?step=circular`);
  console.log('Press Ctrl+C to stop the demo.\n');
} catch (err) {
  console.error(`Demo failed: ${err.message}`);
  stop(1);
}
