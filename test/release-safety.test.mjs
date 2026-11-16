import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';

function run(script, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `child exited ${code}`)));
  });
}

test('concurrent CA creation produces matching certificates', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peekr-ca-race-'));
  const moduleUrl = new URL('../lib/workspace-ca.mjs', import.meta.url).href;
  const script = `import { createWorkspaceCA } from ${JSON.stringify(moduleUrl)}; const ca = createWorkspaceCA(process.argv[1]); const leaf = ca.certificate('localhost'); console.log(leaf.cert.toString('base64'));`;
  try {
    const [first, second] = await Promise.all([run(script, [dir]), run(script, [dir])]);
    assert.equal(first, second);
    assert.ok(readFileSync(join(dir, 'root-cert.pem')).length);
    const certFiles = (await import('node:fs')).readdirSync(dir).filter(file => file.endsWith('-cert.pem') && file !== 'root-cert.pem');
    const keyFile = certFiles[0].replace('-cert.pem', '-key.pem');
    assert.doesNotThrow(() => tls.createSecureContext({ cert: readFileSync(join(dir, certFiles[0])), key: readFileSync(join(dir, keyFile)) }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legacy child runner does not disable TLS verification', { timeout: 10000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peekr-child-'));
  const moduleUrl = new URL('../lib/child-runner.mjs', import.meta.url).href;
  const script = `import { spawnWithIntercept } from ${JSON.stringify(moduleUrl)}; const child = spawnWithIntercept([process.execPath, '-e', "process.stdout.write(process.env.NODE_TLS_REJECT_UNAUTHORIZED || 'unset')"], 12345); child.stdout.pipe(process.stdout); child.on('exit', code => { process.exitCode = code; });`;
  const env = { ...process.env };
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  try { assert.equal(await run(script, [], { cwd: dir, env }), 'unset'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
