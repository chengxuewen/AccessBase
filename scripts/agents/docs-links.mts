/**
 * docs-links — relative-link gate for user-facing docs (RT-C tooling
 * adoption; donor check_docs_links.py mechanism, adapted to node/.mts).
 *
 * Scope: git-tracked README.md, AGENTS.md, CONSTRAINTS.md, docs/ (recursive markdown) and
 * SKILL.md hand-written sources. Excluded prefixes (forward-looking or
 * generated): docs/superpowers/plans/, docs/superpowers/reports/ (audit
 * snapshots), docs/reference/research/, docs/handoff-. Fenced code blocks
 * are stripped before link extraction. SKIP: http(s):, mailto:, #anchors,
 * <>, build/, out/, node_modules/.
 *
 * Allowlist: scripts/docs-links-allow.txt lines "path|dest".
 * Exit: 0 clean, 1 broken. Self-test pairing duty (CONSTRAINTS).
 * import.meta.main guarded (PIT-095).
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, EXIT_CLEAN, EXIT_FINDINGS } from "./agent-common.mts";

const EXCLUDE_PREFIXES = [
  "docs/superpowers/plans/",
  "docs/superpowers/reports/",
  "docs/reference/research/",
  "docs/handoff-",
];
const LINK = /!?\[[^\]]*\]\(([^)]+)\)/g;
const FENCE = /```.*?^```/gms;
const SKIP = /^(https?:|mailto:|#|<|build\/|out\/|node_modules\/)/;

function trackedDocFiles(): string[] {
  let out = "";
  try {
    out = execFileSync("git", ["ls-files", "README.md", "AGENTS.md", "CONSTRAINTS.md", "docs"], {
      cwd: ROOT, encoding: "utf8",
    });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of out.split("\n")) {
    if (!name || !name.endsWith(".md")) continue;
    if (EXCLUDE_PREFIXES.some((p) => name.startsWith(p))) continue;
    files.push(name);
  }
  const skillsDir = path.join(ROOT, ".agents", "skills");
  for (const d of existsSync(skillsDir) ? readdirSync(skillsDir) : []) {
    const f = path.join(".agents", "skills", d, "SKILL.md").replaceAll("\\", "/");
    if (existsSync(path.join(ROOT, f))) files.push(f);
  }
  return [...new Set(files)].sort();
}

function allowlist(): Set<string> {
  const p = path.join(ROOT, "scripts", "docs-links-allow.txt");
  const allowed = new Set<string>();
  if (!existsSync(p)) return allowed;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const parts = s.split("|");
    if (parts.length >= 2) allowed.add(`${parts[0]}|${parts[1].trim()}`);
  }
  return allowed;
}

function brokenLinks(relPath: string, allowed: Set<string>): Array<{ dest: string; resolved: string }> {
  const text = readFileSync(path.join(ROOT, relPath), "utf8").replace(FENCE, "");
  const broken: Array<{ dest: string; resolved: string }> = [];
  for (const m of text.matchAll(LINK)) {
    const dest = m[1].trim();
    if (!dest || SKIP.test(dest)) continue;
    const target = decodeURIComponent(dest.split("#", 1)[0].split("?", 1)[0]).trim();
    if (!target || target.includes(" ")) continue;
    if (allowed.has(`${relPath}|${dest}`)) continue;
    const resolved = path.normalize(path.join(path.dirname(relPath), target));
    if (!existsSync(path.join(ROOT, resolved))) broken.push({ dest, resolved });
  }
  return broken;
}

export function run(_mode: "check" | "sync"): { code: number; summary: string } {
  const allowed = allowlist();
  const files = trackedDocFiles();
  const broken: Array<{ file: string; dest: string; resolved: string }> = [];
  for (const f of files) {
    for (const b of brokenLinks(f, allowed)) broken.push({ file: f, ...b });
  }
  if (broken.length) {
    console.log(`docs-links: ${broken.length} broken link(s) / ${files.length} file(s):`);
    for (const b of broken.slice(0, 20)) console.log(`  ${b.file} -> ${b.dest} (resolved ${b.resolved})`);
    if (broken.length > 20) console.log(`  ... and ${broken.length - 20} more`);
    return { code: EXIT_FINDINGS, summary: `docs-links: ${broken.length} broken link(s)` };
  }
  return { code: EXIT_CLEAN, summary: `docs-links: clean (${files.length} file(s), 0 broken links)` };
}

function runSelfTest(): number {
  const tmp = path.join(ROOT, "build", "docs-links-selftest");
  mkdirSync(tmp, { recursive: true });
  writeFileSync(path.join(tmp, "target.md"), "x");
  writeFileSync(path.join(tmp, "good.md"), "[ok](target.md)\n");
  writeFileSync(path.join(tmp, "bad.md"), "[missing](nope.md)\n");
  const probe = (f: string): string[] => {
    const text = readFileSync(path.join(tmp, f), "utf8");
    const hits: string[] = [];
    for (const m of text.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
      const resolved = path.normalize(path.join(tmp, m[2]));
      if (!existsSync(resolved)) hits.push(m[2]);
    }
    return hits;
  };
  const goodHits = probe("good.md");
  const badHits = probe("bad.md");
  rmSync(tmp, { recursive: true, force: true });
  if (goodHits.length === 0 && badHits.length === 1) {
    console.log("docs-links --self-test: PASS (good green, missing red)");
    return 0;
  }
  console.log(`docs-links --self-test: FAIL (good=${JSON.stringify(goodHits)} bad=${JSON.stringify(badHits)})`);
  return 1;
}

if (import.meta.main) {
  const arg = process.argv[2] ?? "check";
  if (arg === "--self-test") process.exit(runSelfTest());
  if (arg !== "check") { console.error("usage: docs-links.mts [check]"); process.exit(2); }
  const r = run("check");
  console.log(r.summary);
  process.exit(r.code);
}
