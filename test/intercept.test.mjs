import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createReverseProxy } from '../lib/reverse-proxy.mjs';
import { createProxyServer } from '../lib/proxy-core.mjs';
import { createUiServer } from '../lib/ui-server.mjs';
import { onBreakpoint, pauseAtBreakpoint, resolveBreakpoint, setInterceptEnabled, getPendingBreakpoints } from '../lib/breakpoint-manager.mjs';

test('global intercept pauses incoming and outgoing requests and releases only global pauses', { timeout: 10000 }, async () => {
  let releaseResponse;
  const app = http.createServer((req, res) => {
    if (req.url === '/incoming') releaseResponse = () => res.end('ok');
    else res.end('ok');
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const records = [];
  const reverse = await createReverseProxy({ port: 0, appPort: app.address().port, host: '127.0.0.1', onRequest: record => records.push(record) });
  const proxy = await createProxyServer({ port: 0, host: '127.0.0.1', onRequest: () => {} });
  const ui = await createUiServer({ port: 0 });
  const base = `http://127.0.0.1:${ui.port}`;
  const seen = [];
  const unsubscribe = onBreakpoint(bp => seen.push(bp));
  const waitFor = async count => {
    for (let i = 0; i < 100 && seen.length < count; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(seen.length >= count, 'expected paused request');
  };
  try {
    const set = enabled => fetch(`${base}/api/intercept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    assert.equal((await set(true)).status, 200);
    const incoming = fetch(`http://127.0.0.1:${reverse.port}/incoming`);
    await waitFor(1);
    assert.equal(seen[0].direction, 'IN');
    assert.equal(seen[0].timeoutMs, 0);
    resolveBreakpoint(seen[0].id, { action: 'continue' });
    for (let i = 0; i < 100 && !releaseResponse; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(records.length, 1);
    assert.equal(records[0].pending, true);
    assert.equal(records[0].statusCode, null);
    releaseResponse();
    assert.equal(await (await incoming).text(), 'ok');
    assert.equal(records.length, 2);
    assert.equal(records[1].id, records[0].id);
    assert.equal(records[1].statusCode, 200);

    const outgoing = new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port: proxy.port, path: '/outgoing', headers: { 'x-peekr-dest': '127.0.0.1', 'x-peekr-dest-port': app.address().port, 'x-peekr-dest-proto': 'http' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
    });
    await waitFor(2);
    assert.equal(seen[1].direction, 'OUT');
    const independent = pauseAtBreakpoint({ timeoutMs: 0 });
    await waitFor(3);
    const result = await (await set(false)).json();
    assert.equal(result.released, 1);
    assert.equal(await outgoing, 200);
    assert.equal(resolveBreakpoint(seen[2].id, { action: 'block' }), true);
    assert.equal((await independent).action, 'block');
    await set(true);
    const disconnected = http.get(`http://127.0.0.1:${reverse.port}/disconnect`);
    disconnected.on('error', () => {});
    await waitFor(4);
    disconnected.destroy();
    for (let i = 0; i < 100 && getPendingBreakpoints().some(bp => bp.id === seen[3].id); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(!getPendingBreakpoints().some(bp => bp.id === seen[3].id));
  } finally {
    unsubscribe(); setInterceptEnabled(false);
    for (const server of [reverse.server, proxy.server, ui.server, app]) { server.closeAllConnections(); server.close(); }
  }
});
