import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

test('workspace manages services, scoped redirects and saved configuration', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peekr-workspace-'));
  const bin = resolve('bin/peekr.mjs');
  const env = { ...process.env, HOME: dir, TMPDIR: dir };
  const reserve = http.createServer();
  await new Promise(resolvePromise => reserve.listen(0, '127.0.0.1', resolvePromise));
  const port = reserve.address().port;
  await new Promise(resolvePromise => reserve.close(resolvePromise));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [bin, 'workspace', 'start', '--name', 'test', '--port', String(port)], { env, stdio: 'ignore' });
  let restored;
  const api = (path, method = 'GET', data) => fetch(base + path, { method, ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
  const poll = async fn => { for (let i = 0; i < 200; i++) { try { const result = await fn(); if (result) return result; } catch {} await new Promise(r => setTimeout(r, 25)); } throw new Error('timed out'); };
  const upstream = http.createServer((_req, res) => res.end('redirected'));
  await new Promise(resolvePromise => upstream.listen(0, '127.0.0.1', resolvePromise));
  const original = http.createServer((_req, res) => res.end('original'));
  await new Promise(resolvePromise => original.listen(0, '127.0.0.1', resolvePromise));
  try {
    await poll(async () => (await api('/workspace')).ok);
    const created = await (await api('/services', 'POST', { name: 'api', appPort: 3000, project: dir, persist: true, command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'] })).json();
    assert.equal(created.name, 'api');
    assert.equal((await api('/services/api', 'PUT', { name: 'renamed', appPort: 3001, project: dir, command: created.command })).status, 200);
    assert.equal((await api('/services/renamed/start', 'POST', {})).status, 200);
    assert.equal((await (await api('/workspace')).json()).services[0].status, 'running');
    const other = await (await api('/services', 'POST', { name: 'other', appPort: 3002 })).json();
    const rule = { host: '127.0.0.1', method: '*', path: '*', direction: 'OUT', action: 'redirect', sourceService: 'renamed', destinationPort: original.address().port, redirectUrl: `http://127.0.0.1:${upstream.address().port}` };
    assert.equal((await api('/api/rules', 'POST', rule)).status, 201);
    const response = await new Promise((resolvePromise, reject) => {
      http.get({ hostname: '127.0.0.1', port: created.proxyPort, path: `http://127.0.0.1:${original.address().port}/test` }, res => { let body = ''; res.on('data', c => body += c); res.on('end', () => resolvePromise(body)); }).on('error', reject);
    });
    assert.equal(response, 'redirected');
    const otherResponse = await new Promise((resolvePromise, reject) => {
      http.get({ hostname: '127.0.0.1', port: other.proxyPort, path: `http://127.0.0.1:${original.address().port}/test` }, res => { let body = ''; res.on('data', c => body += c); res.on('end', () => resolvePromise(body)); }).on('error', reject);
    });
    assert.equal(otherResponse, 'original');
    assert.equal((await api('/workspace/layout', 'PUT', { renamed: { x: 100, y: 120 } })).status, 200);
    const file = join(dir, 'saved.json');
    const save = spawn(process.execPath, [bin, 'workspace', 'save', '--workspace', 'test', '--file', file], { env, stdio: 'ignore' });
    assert.equal(await new Promise(resolvePromise => save.on('exit', resolvePromise)), 0);
    const saved = JSON.parse(readFileSync(file));
    assert.equal(saved.rules[0].redirectUrl, rule.redirectUrl);
    assert.deepEqual(saved.graphPositions.renamed, { x: 100, y: 120 });
    assert.deepEqual(saved.services[0].command, created.command);
    assert.equal((await api('/services/renamed', 'DELETE', {})).status, 400);
    assert.equal((await api('/services/renamed/stop', 'POST', {})).status, 200);
    await poll(async () => (await (await api('/workspace')).json()).services.find(service => service.name === 'renamed')?.status === 'stopped');
    assert.equal((await api('/services/renamed', 'DELETE', {})).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.peekr', 'services', 'test.json'))).services, []);
    child.kill('SIGTERM');
    await new Promise(resolvePromise => child.once('exit', resolvePromise));
    restored = spawn(process.execPath, [bin, 'workspace', 'start', '--config', file, '--port', String(port)], { env, stdio: 'ignore' });
    const state = await poll(async () => { const result = await (await api('/workspace')).json(); return result.services.length && result; });
    assert.ok(state.services.some(service => service.name === 'renamed'));
    assert.equal(state.rules[0].sourceService, 'renamed');
    assert.deepEqual(state.graphPositions.renamed, { x: 100, y: 120 });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (restored && restored.exitCode === null && restored.signalCode === null) { restored.kill('SIGTERM'); await new Promise(resolvePromise => restored.once('exit', resolvePromise)); }
    upstream.closeAllConnections(); upstream.close(); original.closeAllConnections(); original.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
