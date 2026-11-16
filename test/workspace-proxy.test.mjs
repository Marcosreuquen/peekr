import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWorkspaceCA } from '../lib/workspace-ca.mjs';
import { createWorkspaceProxy } from '../lib/workspace-proxy.mjs';
import { addRule, removeRule } from '../lib/rules-engine.mjs';

test('captures HTTP and validates HTTPS through CONNECT', { timeout: 8000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peekr-test-ca-'));
  const ca = createWorkspaceCA(dir);
  const records = [];
  const { server: proxy, port } = await createWorkspaceProxy({ ca, onRequest: record => records.push(record) });
  const upstream = http.createServer((req, res) => res.end('hello'));
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const secureUpstream = https.createServer(ca.certificate('127.0.0.1'), (_req, res) => res.end('secure hello'));
  await new Promise(resolve => secureUpstream.listen(0, '127.0.0.1', resolve));
  const originalCA = https.globalAgent.options.ca;
  https.globalAgent.options.ca = readFileSync(ca.certPath);
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: `http://127.0.0.1:${upstream.address().port}/hello` }, res => {
        let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve(body));
      }); req.on('error', reject);
    });
    assert.equal(response, 'hello');
    assert.equal(records[0].direction, 'OUT');
    assert.equal(records[0].url, '/hello');
    const securePort = secureUpstream.address().port;
    const tunnel = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: `127.0.0.1:${securePort}` });
    const socket = await new Promise((resolve, reject) => { tunnel.on('connect', (_res, socket) => resolve(socket)); tunnel.on('error', reject); tunnel.end(); });
    const encrypted = tls.connect({ socket, ca: readFileSync(ca.certPath), checkServerIdentity: (_hostname, cert) => tls.checkServerIdentity('127.0.0.1', cert) });
    await new Promise((resolve, reject) => { encrypted.once('secureConnect', resolve); encrypted.once('error', reject); });
    assert.equal(encrypted.authorized, true);
    const secureResponse = new Promise((resolve, reject) => {
      let body = '';
      encrypted.on('data', chunk => { body += chunk; if (body.includes('secure hello')) resolve(body); });
      encrypted.on('error', reject);
    });
    encrypted.write(`GET /secure HTTP/1.1\r\nHost: 127.0.0.1:${securePort}\r\nConnection: close\r\n\r\n`);
    assert.match(await secureResponse, /secure hello/);
    assert.ok(records.some(record => record.url === '/secure' && record.statusCode === 200));
    encrypted.destroy();
    socket.destroy();
    const proxyUrl = `http://127.0.0.1:${port}`;
    const result = await promisify(execFile)('python3', ['-c', `import urllib.request; print(urllib.request.urlopen('https://127.0.0.1:${securePort}/python').read().decode())`], {
      env: { ...process.env, https_proxy: proxyUrl, HTTPS_PROXY: proxyUrl, no_proxy: '', NO_PROXY: '', SSL_CERT_FILE: ca.certPath },
    });
    assert.equal(result.stdout.trim(), 'secure hello');
    assert.ok(records.some(record => record.url === '/python' && record.statusCode === 200));
    const rule = addRule({ host: '127.0.0.1', path: '/blocked', method: 'GET', action: 'block', direction: 'OUT' });
    try {
      const status = await new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: `http://127.0.0.1:${upstream.address().port}/blocked` }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', reject);
      });
      assert.equal(status, 403);
      assert.equal(records.at(-1).ruleAction, 'blocked');
    } finally { removeRule(rule.id); }
  } finally {
    proxy.closeAllConnections();
    upstream.closeAllConnections();
    secureUpstream.closeAllConnections();
    proxy.close();
    await Promise.all([new Promise(resolve => upstream.close(resolve)), new Promise(resolve => secureUpstream.close(resolve))]);
    https.globalAgent.options.ca = originalCA;
    rmSync(dir, { recursive: true, force: true });
  }
});
