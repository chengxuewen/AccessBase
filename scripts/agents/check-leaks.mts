/**
 * check-leaks — tracked files that simultaneously match .gitignore rules
 * (plan Batch G1′, MS O-2 pattern, 12-line original). `git ls-files -i -c
 * --exclude-standard` is the whole detector; a hit means either a force-add
 * bypassed an ignore rule, or an ignore rule grew too broad over a tracked
 * source file. Both are red: the first is a policy bypass, the second makes
 * the file unmaintainable through normal git flows.
 *
 * Read-only (exit 0 clean / 1 findings). Current baseline is zero after the
 * 18 process reports were removed from the index (ruling A, 2026-11-17).
 */

import { execSync } from "node:child_process";
import { ROOT, EXIT_CLEAN, EXIT_FINDINGS } from "./agent-common.mts";

export function run(_mode: "check" | "sync"): { code: number; summary: string } {
  let hits = "";
  try {
    hits = execSync("git ls-files -i -c --exclude-standard", {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // no git context (exported tree): yellow note, never red
    console.log("  check-leaks: no git context, skip (not a finding)");
    return { code: EXIT_CLEAN, summary: "check-leaks: skip (no git)" };
  }
  if (!hits) return { code: EXIT_CLEAN, summary: "check-leaks: clean (0 tracked-and-ignored files)" };
  const list = hits.split("\n");
  console.log(`check-leaks: ${list.length} tracked file(s) also match .gitignore:`);
  for (const f of list) console.log(`  ${f}`);
  console.log("  fix: either narrow the ignore rule, or `git rm --cached <file>` if the file is a process artifact (disk copy stays)");
  return { code: EXIT_FINDINGS, summary: `check-leaks: ${list.length} finding(s)` };
}

if (import.meta.main) {
  const arg = process.argv[2] ?? "check";
  if (arg !== "check") { console.error("usage: check-leaks.mts [check]"); process.exit(2); }
  process.exit(run("check").code);
}
