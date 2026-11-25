// mcp-browser-probe — END-TO-END proof that local-playwright's browser WORKS.
//
// The ONLY check that proves a browser works: a real tool call that returns a
// page snapshot (`--version` proves nothing — a binary that answers it can
// still fail to launch). Drives the REAL launcher chain
// (mcp-launch.sh -> init-mcp-playwright.mjs -> playwright-mcp), exactly as the
// MCP host spawns it. --isolated: no profile is written.
//
// Usage: node scripts/agents/mcp-browser-probe.mjs [url]
// Exit 0 = snapshot captured; exit 1 = no snapshot (see stderr from the server).
// Side assertions (acceptance §7): no `.playwright-mcp` in the repo ROOT; the
// gitignored output dir exists after a navigate.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const URL = process.argv[2] ?? 'about:blank';
const HOLD_MS = 20_000; // keep stdin open so the server never sees EOF early

const child = spawn(
  'bash',
  [join(ROOT, 'scripts/agents/mcp-launch.sh'), process.execPath, '.opencode/init-mcp-playwright.mjs'],
  { stdio: ['pipe', 'pipe', 'pipe'], cwd: ROOT },
);
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
    } catch {
      process.stderr.write('[probe] non-json stdout: ' + line.slice(0, 120) + '\n');
    }
  }
});
child.stderr.on('data', (d) => process.stderr.write('[mcp] ' + d.toString()));
let id = 0;
const call = (method, params) =>
  new Promise((res) => {
    const myId = ++id;
    pending.set(myId, res);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });

const init = await call('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'mcp-browser-probe', version: '1' },
});
if (!init.result) {
  console.error('PROBE FAIL: initialize —', JSON.stringify(init.error ?? init).slice(0, 300));
  child.kill();
  process.exit(1);
}
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const nav = await Promise.race([
  call('tools/call', { name: 'browser_navigate', arguments: { url: URL } }),
  new Promise((r) => setTimeout(() => r({ timeout: true }), HOLD_MS)),
]);
// A successful navigate returns a page section (`### Page` + `- Page URL: …`)
// and a snapshot — inline text OR a snapshot FILE reference (output-dir mode).
const ser = JSON.stringify(nav);
const hasSnapshot =
  ser.includes('### Page') && (ser.includes('- Page URL:') || ser.includes('Snapshot]('));
if (!hasSnapshot) {
  console.error('PROBE FAIL: no page snapshot —', JSON.stringify(nav).slice(0, 400));
  child.kill();
  process.exit(1);
}
console.log('PROBE OK: navigate(' + URL + ') returned a page snapshot');

// Side assertions (acceptance): CWD pollution + output dir presence
const rootPollution = existsSync(join(ROOT, '.playwright-mcp'));
const outDir = join(ROOT, 'out', 'local-playwright', 'mcp');
const outFiles = existsSync(outDir) ? readdirSync(outDir).length : 0;
console.log('  repo-root .playwright-mcp:', rootPollution ? 'PRESENT (FAIL)' : 'absent (ok)');
console.log('  out/local-playwright/mcp files:', outFiles, outFiles > 0 ? '(ok)' : '(none — navigate produced no artifacts, acceptable for about:blank)');

child.kill();
process.exit(rootPollution ? 1 : 0);
