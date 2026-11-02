/**
 * T4 (hygiene-batch-v2, G11): generate the api.md "Current surface" inventory.
 * TWO sources joined (dual-Momus: openapi carries NO permission codes):
 *   1. docs/openapi.json — methods/paths/descriptions
 *   2. packages/identity/src/hooks/authorize.ts routePermissions — wire permission codes
 * Output: markdown grouped by first path segment. Stdout → paste into api.md.
 * Run: pixi run npx tsx scripts/gen-api-inventory.mts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const openapi = JSON.parse(readFileSync(resolve(ROOT, 'docs/openapi.json'), 'utf8')) as {
  paths: Record<string, Record<string, { summary?: string; description?: string }>>;
};

// routePermissions: parse the map literally (it is a static object literal in
// authorize.ts — 'path-regex': 'code' entries). Regex-extract pairs.
const authorizeSrc = readFileSync(resolve(ROOT, 'packages/identity/src/hooks/authorize.ts'), 'utf8');
// Keys are 'METHOD:/path' — match the openapi path directly (both are
// literal paths; params appear as {id} in openapi vs :id in the map).
const permMap = new Map<string, string>();
const pairRe = /'(GET|POST|PUT|PATCH|DELETE):([^']+)'\s*:\s*'([a-z]+:(?:read|write|delete))'/g;
let m: RegExpExecArray | null;
while ((m = pairRe.exec(authorizeSrc)) !== null) {
  permMap.set(`${m[1]}:${m[2]}`, m[3]);
}

function permissionFor(path: string, method: string): string {
  // exact match first (openapi {id} vs map :id normalized)
  const norm = path.replace(/\{([^}]+)\}/g, ':$1').replace(/\/+$/, '');
  const direct = permMap.get(`${method.toUpperCase()}:${norm}`);
  if (direct) return direct;
  // longest-prefix fallback (trailing-slash / sub-path variance)
  let best: string | null = null;
  for (const [key, code] of permMap) {
    const [km, kp] = key.split(':');
    if (km !== method.toUpperCase()) continue;
    const re = new RegExp('^' + kp.replace(/:[^/]+/g, '[^/]+') + '(/.*)?$');
    if (re.test(norm) && (best === null || kp.length > (permMap.get(`${method}:${best}`) ? best.length : 0))) {
      best = code;
    }
  }
  return best ?? '—';
}

const groups = new Map<string, Array<{ method: string; path: string; summary: string; perm: string }>>();
for (const [path, methods] of Object.entries(openapi.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const seg = path.split('/').filter(Boolean)[2] ?? 'root'; // after api/v1
    if (!groups.has(seg)) groups.set(seg, []);
    groups.get(seg)!.push({
      method: method.toUpperCase(),
      path,
      summary: (op.summary ?? op.description ?? '').replace(/\|/g, '\\|').slice(0, 90),
      perm: permissionFor(path, method),
    });
  }
}

const out: string[] = [];
out.push(`Generated 2026-11-02 from docs/openapi.json (methods/paths) × packages/identity/src/hooks/authorize.ts routePermissions (codes).
Regenerate: \`pixi run npx tsx scripts/gen-api-inventory.mts >> docs/modules/api.md\` (paste under this heading). Total paths: ${Object.keys(openapi.paths).length}.`);
out.push('');
for (const [seg, rows] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  out.push(`### /api/v1/${seg} (${rows.length})`);
  out.push('');
  out.push('| Method | Path | Permission | Summary |');
  out.push('|--------|------|------------|---------|');
  for (const r of rows.sort((a, b) => a.path.localeCompare(b.path))) {
    out.push(`| ${r.method} | \`${r.path}\` | ${r.perm} | ${r.summary} |`);
  }
  out.push('');
}
console.log(out.join('\n'));
