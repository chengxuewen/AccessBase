import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * S2 (P-5=B): the hand-CSS boundary lock. Raw CSS may live ONLY in:
 *   - src/index.css            (pre-existing .sr-only utility, main.tsx)
 *   - src/theme/pack-vars.css  (THE exemption file — pack-driven rules)
 * and stylesheet imports may appear ONLY in main.tsx. PackStyleVars's
 * <style> JSX lives inside theme/ (allowed region). Anything else = red.
 */
const SRC = path.resolve(__dirname, '../..'); // app root — rel paths carry 'src/'
const ALLOWED_CSS_FILES = ['src/index.css', 'src/theme/pack-vars.css'];
const ALLOWED_IMPORT_SITES = ['src/main.tsx'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (p.includes('node_modules') || name === 'dist') continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe('hand-CSS boundary (S2, P-5=B)', () => {
  it('no stylesheet file exists outside the allowlist', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const rel = path.relative(SRC, f).split(path.sep).join('/');
      if (f.endsWith('.css') && !ALLOWED_CSS_FILES.includes(rel)) offenders.push(rel);
    }
    expect(offenders, `stray css files: ${offenders.join(', ')}`).toEqual([]);
  });

  it('stylesheet imports appear only in allowed sites, importing only allowlisted files', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      if (!/\.(tsx?)$/.test(f)) continue;
      const src = readFileSync(f, 'utf-8');
      const imports = [...src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+\.css)['"]/g)].map(
        (m) => m[1] ?? '',
      );
      if (imports.length === 0) continue;
      const rel = path.relative(SRC, f).split(path.sep).join('/');
      if (!ALLOWED_IMPORT_SITES.includes(rel)) offenders.push(`${rel} imports css`);
      for (const imp of imports) {
        const target = path.relative(SRC, path.resolve(path.dirname(f), imp)).split(path.sep).join('/');
        if (!ALLOWED_CSS_FILES.includes(target)) offenders.push(`${rel} -> ${target} (not allowlisted)`);
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
  });

  it('raw <style> JSX appears only inside theme/', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      if (!/\.(tsx)$/.test(f)) continue;
      const src = readFileSync(f, 'utf-8');
      if (!/<style/.test(src)) continue;
      const rel = path.relative(SRC, f).split(path.sep).join('/');
      if (!rel.startsWith('src/theme/')) offenders.push(rel);
    }
    expect(offenders, offenders.join(', ')).toEqual([]);
  });
});
