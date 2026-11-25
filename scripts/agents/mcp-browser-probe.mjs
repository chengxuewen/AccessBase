// stdio JSON-RPC probe: launch playwright-mcp with the given args and call
// browser_navigate — proves whether the MCP can drive the REPO's bundled
// chromium-1234 via executablePath (its own playwright 1.63-alpha has no
// ubuntu20.04 chromium build).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const exe = require('@playwright/test').chromium.executablePath();
const mode = process.argv[2] ?? 'config';
const cfg = join(tmpdir(), 'ab-mcp-probe-config.json');
writeFileSync(
  cfg,
  JSON.stringify({ browser: { browserName: 'chromium', isolated: true, launchOptions: { executablePath: exe } } }),
);
const args =
  mode === 'config'
    ? ['--config', cfg, '--isolated']
    : ['--isolated', '--browser', 'chromium', '--executable-path', exe];
const child = spawn('node_modules/.bin/playwright-mcp', args, { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) pending.get(msg.id)(msg);
    } catch {}
  }
});
child.stderr.on('data', (d) => process.stderr.write('[mcp-err] ' + d.toString()));
let id = 0;
const call = (method, params) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });
const init = await call('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'probe', version: '0' },
});
console.log('INIT:', init.result ? 'ok' : JSON.stringify(init.error));
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const nav = await Promise.race([
  call('tools/call', { name: 'browser_navigate', arguments: { url: 'http://localhost:5173/login' } }),
  new Promise((r) => setTimeout(() => r({ timeout: true }), 25000)),
]);
const text = JSON.stringify(nav);
console.log('NAV:', text.includes('Error') || nav.timeout ? text.slice(0, 400) : 'OK ' + text.slice(0, 160));
child.kill();
process.exit(0);
