import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { rootCertificates } from 'node:tls';
import { getArg } from './args.mjs';
import { createReverseProxy } from './reverse-proxy.mjs';
import { createWorkspaceCA } from './workspace-ca.mjs';
import { createWorkspaceProxy } from './workspace-proxy.mjs';
import { createUiHandler } from './ui-server.mjs';
import * as rulesEngine from './rules-engine.mjs';

const registryDir = join(tmpdir(), `peekr-workspaces-${process.getuid?.() ?? 'user'}`);

async function findWorkspace(args) {
  const wanted = getArg(args, 'workspace');
  let files;
  try { files = readdirSync(registryDir).filter(file => file.endsWith('.json')); }
  catch (err) { if (err.code === 'ENOENT') files = []; else throw err; }
  const active = [];
  for (const file of files) {
    try {
      const entry = JSON.parse(readFileSync(join(registryDir, file), 'utf8'));
      const info = await callWorkspace(entry.port, '/workspace');
      if (info.name === entry.name && info.instanceId === entry.instanceId) active.push(entry);
    } catch {}
  }
  const matches = wanted ? active.filter(entry => entry.name === wanted) : active;
  if (!matches.length) throw new Error(wanted ? `workspace ${wanted} is not running` : 'no workspace is running; start one with peekr workspace start');
  if (matches.length > 1) throw new Error(`multiple workspaces are running (${matches.map(entry => entry.name).join(', ')}); specify --workspace`);
  return matches[0];
}

const help = `Usage:
  peekr workspace start [--name default] [--port 49800] [--config workspace.json]
  peekr add [--workspace NAME] [--name NAME] [--app-port 3000] [--project .] [-- command...]
  peekr workspace save [--workspace NAME] --file workspace.json

The add command registers an HTTP service and writes its
configuration under <project>/.peekr/services/<workspace>.json.
The workspace configuration is optional and loaded only with --config.`;

function nameValue(value, label) {
  if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) throw new Error(`${label} must contain only letters, numbers, hyphens or underscores`);
  return value;
}

function portValue(value, label) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) throw new Error(`${label} must be a port between 1 and 65535`);
  return Number(value);
}

function isReachable(port) {
  return new Promise(resolvePromise => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(300);
    socket.once('connect', () => { socket.destroy(); resolvePromise(true); });
    socket.once('error', () => resolvePromise(false));
    socket.once('timeout', () => { socket.destroy(); resolvePromise(false); });
  });
}

function stopManagedChild(child) {
  if (process.platform !== 'win32' && child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); return; } catch (err) { if (err.code !== 'ESRCH') throw err; }
  }
  child.kill('SIGTERM');
}

function saveService(project, workspace, service, previousName = service.name) {
  const dir = join(project, '.peekr', 'services');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${workspace}.json`);
  let saved = { workspace, services: [] };
  try { saved = JSON.parse(readFileSync(path, 'utf8')); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const { name, appPort, command } = service;
  saved.services = [...saved.services.filter(item => item.name !== name && item.name !== previousName), { name, appPort, ...(command?.length ? { command } : {}) }];
  writeFileSync(path, JSON.stringify(saved, null, 2) + '\n');
  return path;
}

function removeSavedService(project, workspace, serviceName) {
  if (!project) return;
  const path = join(project, '.peekr', 'services', `${workspace}.json`);
  let saved;
  try { saved = JSON.parse(readFileSync(path, 'utf8')); } catch (err) { if (err.code === 'ENOENT') return; throw err; }
  saved.services = saved.services.filter(item => item.name !== serviceName);
  writeFileSync(path, JSON.stringify(saved, null, 2) + '\n');
}

function workspaceSnapshot(current) {
  const services = current.services.map(({ name, appPort, reversePort, project, command }) => ({ name, appPort, reversePort, ...(project ? { project } : {}), ...(command?.length ? { command } : {}) }));
  return { name: current.name, services, rules: current.rules, graphPositions: current.graphPositions };
}

function callWorkspace(port, path, body) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString());
          if (res.statusCode >= 400) reject(new Error(result.error));
          else resolvePromise(result);
        } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function startWorkspace(args) {
  const configPath = getArg(args, 'config');
  const config = configPath ? JSON.parse(readFileSync(resolve(configPath), 'utf8')) : {};
  const name = nameValue(getArg(args, 'name') || config.name || 'default', 'workspace name');
  const port = portValue(getArg(args, 'port') || 49800, 'workspace port');
  const instanceId = randomUUID();
  const services = new Map();
  const resources = new Map();
  let graphPositions = config.graphPositions || {};
  const ca = createWorkspaceCA();
  const dashboard = createUiHandler({ rulesEngine });
  const events = [];
  const publish = (service, record, serviceId) => {
    const current = services.get(service);
    if (current) {
      current.capture ||= { incoming: false, outgoing: false, https: false };
      if (record.direction === 'IN') current.capture.incoming = true;
      if (record.direction === 'OUT') current.capture.outgoing = true;
      if (record.direction === 'OUT' && record.destinationProtocol === 'https') current.capture.https = true;
    }
    const entry = { ...record, service, id: `${serviceId}-${record.direction}-${record.id}` };
    const index = events.findIndex(item => item.id === entry.id);
    if (index === -1) events.push(entry);
    else events[index] = { ...events[index], ...entry, pending: entry.pending === true };
    dashboard.broadcast(entry);
    if (events.length > 1000) events.shift();
  };
  async function addService(data) {
    let serviceName = nameValue(data.name, 'service name');
    const serviceId = randomUUID();
    const appPort = portValue(data.appPort, 'app port');
    if (services.has(serviceName)) throw new Error(`service ${serviceName} already exists`);
    const requestedPort = data.reversePort == null ? 0 : portValue(data.reversePort, 'reverse port');
    const serviceState = { name: serviceName, appPort };
    const { server, port: boundPort } = await createReverseProxy({ port: requestedPort, appPort, getAppPort: () => serviceState.appPort, host: '127.0.0.1', service: () => serviceName, onRequest: record => publish(serviceName, record, serviceId) });
    const actualPort = server.address().port;
    let outgoing;
    try { outgoing = await createWorkspaceProxy({ ca, service: () => serviceName, onRequest: record => publish(serviceName, record, serviceId) }); }
    catch (err) { server.close(); throw err; }
    const service = Object.assign(serviceState, { reversePort: requestedPort === 0 ? actualPort : boundPort, proxyPort: outgoing.port, status: 'external', ...(data.project ? { project: resolve(data.project) } : {}), ...(Array.isArray(data.command) && data.command.length ? { command: data.command } : {}) });
    services.set(serviceName, service);
    resources.set(serviceName, { reverse: server, outgoing: outgoing.server, child: null, rename: value => { serviceName = value; } });
    return service;
  }
  for (const service of config.services || []) await addService(service);
  for (const rule of config.rules || []) rulesEngine.addRule(rule);

  async function startManagedService(service, resource) {
    if (resource.child) throw new Error('service is already running under Peekr');
    if (!Array.isArray(service.command) || !service.command.length || service.command.some(item => typeof item !== 'string' || !item)) throw new Error('configure a command as an array of arguments first');
    const project = service.project || process.cwd();
    const dir = join(project, '.peekr', 'services');
    mkdirSync(dir, { recursive: true });
    const bundle = join(dir, `${name}-ca-bundle.pem`);
    const base = process.env.REQUESTS_CA_BUNDLE ? readFileSync(process.env.REQUESTS_CA_BUNDLE, 'utf8') : rootCertificates.join('\n');
    writeFileSync(bundle, `${base}\n${readFileSync(ca.certPath, 'utf8')}`, { mode: 0o600 });
    const proxy = `http://127.0.0.1:${service.proxyPort}`;
    const env = { ...process.env, http_proxy: proxy, https_proxy: proxy, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, no_proxy: '', NO_PROXY: '', NODE_EXTRA_CA_CERTS: bundle, NODE_USE_ENV_PROXY: '1', REQUESTS_CA_BUNDLE: bundle, SSL_CERT_FILE: bundle };
    const child = spawn(service.command[0], service.command.slice(1), { cwd: project, env, stdio: 'ignore', detached: process.platform !== 'win32' });
    resource.child = child;
    service.status = 'starting';
    child.once('exit', code => { resource.child = null; service.status = 'stopped'; service.exitCode = code; });
    child.once('error', err => { resource.child = null; service.status = 'stopped'; service.error = err.message; });
    await new Promise((resolvePromise, reject) => { child.once('spawn', resolvePromise); child.once('error', reject); });
    service.status = 'running';
    delete service.error;
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (!['127.0.0.1', 'localhost', '[::1]'].includes((req.headers.host || '').replace(/:\d+$/, ''))) { res.statusCode = 403; return res.end('Invalid host'); }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { res.statusCode = 403; return res.end('Invalid origin'); }
      if (req.method === 'GET' && req.url === '/ca.crt') { res.setHeader('content-type', 'application/x-pem-file'); return res.end(readFileSync(ca.certPath)); }
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/workspace') {
        const list = await Promise.all([...services.values()].map(async service => ({ ...service, reachable: await isReachable(service.appPort) })));
        return res.end(JSON.stringify({ name, instanceId, services: list, rules: rulesEngine.getRules(), graphPositions }));
      }
      if (req.method === 'PUT' && req.url === '/workspace/layout') {
        if (!req.headers['content-type']?.startsWith('application/json')) { res.statusCode = 415; return res.end(JSON.stringify({ error: 'JSON required' })); }
        const chunks = [];
        for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).length > 16384) throw new Error('request too large'); }
        const data = JSON.parse(Buffer.concat(chunks).toString());
        if (!data || typeof data !== 'object' || Array.isArray(data) || Object.entries(data).some(([key, value]) => !services.has(key) || !Number.isFinite(value?.x) || !Number.isFinite(value?.y) || value.x < 0 || value.y < 0 || value.x > 10000 || value.y > 10000)) throw new Error('invalid graph positions');
        graphPositions = data;
        return res.end(JSON.stringify({ graphPositions }));
      }
      if (req.method === 'GET' && req.url === '/traffic') return res.end(JSON.stringify(events));
      if (req.method === 'POST' && req.url === '/workspace/save') {
        if (!req.headers['content-type']?.startsWith('application/json')) { res.statusCode = 415; return res.end(JSON.stringify({ error: 'JSON required' })); }
        const chunks = [];
        for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).length > 16384) throw new Error('request too large'); }
        const data = JSON.parse(Buffer.concat(chunks).toString());
        if (typeof data.file !== 'string' || !data.file.trim()) throw new Error('file path required');
        const file = resolve(data.file);
        writeFileSync(file, JSON.stringify(workspaceSnapshot({ name, services: [...services.values()], rules: rulesEngine.getRules(), graphPositions }), null, 2) + '\n', { flag: 'wx' });
        return res.end(JSON.stringify({ file }));
      }
      const serviceRoute = req.url.match(/^\/services\/([^/]+)(?:\/(start|stop))?$/);
      if (serviceRoute && ['PUT', 'DELETE', 'POST'].includes(req.method)) {
        if (!req.headers['content-type']?.startsWith('application/json')) { res.statusCode = 415; return res.end(JSON.stringify({ error: 'JSON required' })); }
        const key = decodeURIComponent(serviceRoute[1]);
        const service = services.get(key);
        const resource = resources.get(key);
        if (!service) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'service not found' })); }
        const chunks = [];
        for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).length > 16384) throw new Error('request too large'); }
        const data = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (req.method === 'POST' && serviceRoute[2] === 'start') await startManagedService(service, resource);
        else if (req.method === 'POST' && serviceRoute[2] === 'stop') {
          if (!resource.child) throw new Error('service is not managed by this workspace');
          stopManagedChild(resource.child); service.status = 'stopping';
        } else if (req.method === 'PUT' && !serviceRoute[2]) {
          const newName = nameValue(data.name || key, 'service name');
          const newPort = portValue(data.appPort ?? service.appPort, 'app port');
          if (newName !== key && services.has(newName)) throw new Error(`service ${newName} already exists`);
          if (data.command != null && (!Array.isArray(data.command) || data.command.some(item => typeof item !== 'string' || !item))) throw new Error('command must be an array of non-empty strings');
          const previousProject = service.project;
          const previousPort = service.appPort;
          service.appPort = newPort;
          service.project = data.project ? resolve(data.project) : undefined;
          service.command = data.command?.length ? data.command : undefined;
          if (newName !== key) {
            services.delete(key); resources.delete(key); service.name = newName; resource.rename(newName); services.set(newName, service); resources.set(newName, resource);
            if (graphPositions[key]) { graphPositions[newName] = graphPositions[key]; delete graphPositions[key]; }
            for (const rule of rulesEngine.getRules()) if (rule.sourceService === key) rulesEngine.updateRule(rule.id, { sourceService: newName });
            dashboard.broadcastRules();
          }
          if (previousPort !== newPort && ![...services.values()].some(other => other !== service && other.appPort === previousPort)) {
            let changed = false;
            for (const rule of rulesEngine.getRules()) {
              if (rule.action !== 'redirect' || !rule.redirectUrl) continue;
              const url = new URL(rule.redirectUrl);
              if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && Number(url.port) === previousPort) {
                url.port = String(newPort); rulesEngine.updateRule(rule.id, { redirectUrl: url.origin }); changed = true;
              }
            }
            if (changed) dashboard.broadcastRules();
          }
          if (service.project) saveService(service.project, name, service, key);
          if (previousProject && previousProject !== service.project) removeSavedService(previousProject, name, key);
        } else if (req.method === 'DELETE' && !serviceRoute[2]) {
          if (resource.child && !data.stop) throw new Error('service is running under Peekr; stop it before removing it');
          if (resource.child) stopManagedChild(resource.child);
          resource.reverse.closeAllConnections(); resource.reverse.close();
          resource.outgoing.closeAllConnections(); resource.outgoing.close();
          removeSavedService(service.project, name, key);
          services.delete(key); resources.delete(key);
          delete graphPositions[key];
          for (const rule of rulesEngine.getRules()) if (rule.sourceService === key) rulesEngine.removeRule(rule.id);
          dashboard.broadcastRules();
          return res.end(JSON.stringify({ removed: key }));
        } else { res.statusCode = 404; return res.end(JSON.stringify({ error: 'not found' })); }
        return res.end(JSON.stringify(service));
      }
      if (req.method === 'POST' && req.url === '/services') {
        if (!req.headers['content-type']?.startsWith('application/json')) { res.statusCode = 415; return res.end(JSON.stringify({ error: 'JSON required' })); }
        const chunks = [];
        for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).length > 16384) throw new Error('request too large'); }
        const data = JSON.parse(Buffer.concat(chunks).toString());
        if (data.persist && !data.project) data.project = process.cwd();
        const service = await addService(data);
        if (data.persist) {
          try { saveService(resolve(data.project || process.cwd()), name, service); }
          catch (err) { service.persistenceError = err.message; }
        }
        res.statusCode = 201;
        return res.end(JSON.stringify(service));
      }
      res.removeHeader('content-type');
      dashboard.handler(req, res);
    } catch (err) { res.statusCode = 400; res.end(JSON.stringify({ error: err.message })); }
  });
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolvePromise); });
  if (args.includes('--start-services')) {
    for (const service of services.values()) if (service.command?.length) {
      try { await startManagedService(service, resources.get(service.name)); }
      catch (err) { console.error(`Could not start ${service.name}: ${err.message}`); }
    }
  }
  mkdirSync(registryDir, { recursive: true, mode: 0o700 });
  const registryFile = join(registryDir, `${instanceId}.json`);
  writeFileSync(registryFile, JSON.stringify({ name, port, instanceId }), { mode: 0o600 });
  process.on('exit', () => { try { unlinkSync(registryFile); } catch {} });
  const shutdown = () => {
    for (const resource of resources.values()) if (resource.child) stopManagedChild(resource.child);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  console.log(`Workspace ${name} listening on http://127.0.0.1:${port}`);
  for (const service of services.values()) console.log(`${service.name}: http://localhost:${service.reversePort} -> localhost:${service.appPort}`);
}

export async function addServiceCommand(argv) {
  const sep = argv.indexOf('--');
  const args = sep < 0 ? argv : argv.slice(0, sep);
  const command = sep < 0 ? [] : argv.slice(sep + 1);
  if (args.includes('--help') || args.includes('-h')) return console.log(help);
  if (sep >= 0 && !command.length) throw new Error('provide a command after --');
  const project = resolve(getArg(args, 'project') || '.');
  const name = nameValue(getArg(args, 'name') || basename(project), 'service name');
  const selected = await findWorkspace(args);
  const workspace = selected.name;
  const port = selected.port;
  const appPort = portValue(getArg(args, 'app-port') || 3000, 'app port');
  const reversePort = getArg(args, 'reverse-port');
  const current = await callWorkspace(port, '/workspace');
  if (current.name !== workspace) throw new Error(`running workspace is ${current.name}, not ${workspace}`);
  const service = await callWorkspace(port, '/services', { name, appPort, project, ...(command.length ? { command } : {}), ...(reversePort ? { reversePort: portValue(reversePort, 'reverse port') } : {}) });
  const path = saveService(project, workspace, service);
  console.log(`${name}: http://localhost:${service.reversePort} -> localhost:${appPort}`);
  console.log(`Outgoing proxy: http://127.0.0.1:${service.proxyPort}`);
  console.log(`CA certificate: ${createWorkspaceCA().certPath}`);
  console.log(`Service configuration: ${path}`);
  if (command.length) {
    const ca = createWorkspaceCA();
    const dir = join(project, '.peekr', 'services');
    const bundle = join(dir, `${workspace}-ca-bundle.pem`);
    const base = process.env.REQUESTS_CA_BUNDLE ? readFileSync(process.env.REQUESTS_CA_BUNDLE, 'utf8') : rootCertificates.join('\n');
    writeFileSync(bundle, `${base}\n${readFileSync(ca.certPath, 'utf8')}`, { mode: 0o600 });
    const proxy = `http://127.0.0.1:${service.proxyPort}`;
    const env = { ...process.env, http_proxy: proxy, https_proxy: proxy, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, no_proxy: '', NO_PROXY: '', NODE_EXTRA_CA_CERTS: bundle, NODE_USE_ENV_PROXY: '1', REQUESTS_CA_BUNDLE: bundle, SSL_CERT_FILE: bundle };
    const child = spawn(command[0], command.slice(1), { cwd: project, stdio: 'inherit', env });
    child.on('error', err => { console.error(`Failed to start ${name}: ${err.message}`); process.exitCode = 1; });
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
  }
}

export async function workspaceCommand(args) {
  if (!args.length || args.includes('--help') || args.includes('-h')) return console.log(help);
  if (args[0] === 'start') return startWorkspace(args.slice(1));
  if (args[0] === 'add' && args[1] === 'service') return addServiceCommand(args.slice(2));
  if (args[0] === 'save') {
    const options = args.slice(1);
    const selected = await findWorkspace(options);
    const file = getArg(options, 'file');
    if (!file) throw new Error('provide --file <path>');
    const current = await callWorkspace(selected.port, '/workspace');
    writeFileSync(resolve(file), JSON.stringify(workspaceSnapshot(current), null, 2) + '\n', { flag: 'wx' });
    console.log(`Workspace saved to ${resolve(file)}`);
    return;
  }
  throw new Error(`unknown command\n${help}`);
}
