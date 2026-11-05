#!/usr/bin/env node
/**
 * agent-links — dispatcher over the per-layer generators and lints
 * (plan Batch 2/3; VE adjudication 2-B: per-layer small generators + shared
 * base, no mega-script).
 *
 * Layers (Batch 3 aggregate + Batch 4/8 additions; layering: rule-ref-lint/
 * skill-lint/constraints-index/gate-mcp ⊂ agents check ⊂ ci — ADJ-1c/ADJ-3a):
 *   generators: rules-links, skills-index, memory-aggregate,
 *               instructions-links (Batch 8), mcp-links
 *   lints:      rule-ref-lint, skill-lint, constraints-index, gate-mcp
 *
 * Commands: check | sync | dry-run | list | status
 *   check   — regenerate in memory, compare against disk; red on drift. Read-only.
 *   sync    — repair (idempotent). Guard violations abort with exit 2 BEFORE
 *             anything is written.
 *   status  — read-only overview (always exit 0).
 *   dry-run — check + per-layer summary.   list — declared layers/targets.
 *
 * check/sync end with the hub-budget check (ADJ-2b) and — locally only — the
 * hooks-activation probe (ADJ-3b ruling C: core.hooksPath not pointing at
 * .githooks prints a YELLOW advisory, never affects exit code; CI exempt).
 *
 * Entry points: `bash accessbase.sh agents {sync,check,status}` wraps this;
 * the pre-commit hook (.githooks/pre-commit) calls sync + check directly.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import * as path from "node:path";
import { ROOT, loadTargets, hubBudget, EXIT_CLEAN, EXIT_FINDINGS } from "./agent-common.mts";
import * as rulesLinks from "./rules-links.mts";
import * as skillsIndex from "./skills-index.mts";
import * as memoryAggregate from "./memory-aggregate.mts";
import * as ruleRefLint from "./rule-ref-lint.mts";
import * as skillLint from "./skill-lint.mts";
import * as constraintsIndex from "./constraints-index.mts";
import * as mcpLinks from "./mcp-links.mts";
import * as gateMcp from "./gate-mcp.mts";

const GENERATORS = ["rules-links", "skills-index", "memory-aggregate", "mcp-links"] as const;
const LINTS = ["rule-ref-lint", "skill-lint", "constraints-index", "gate-mcp"] as const;

function hubBudgetCheck(): { code: number; note: string } {
  const cfg = loadTargets();
  const hub = readFileSync(path.join(ROOT, cfg.memory_hub), "utf8");
  const b = hubBudget(hub, cfg.hub_budget);
  const loc = `(${b.chars} chars / ${b.bytes} bytes; caps ${b.hard}/${b.warn})`;
  if (b.over) {
    console.log(`  hub budget EXCEEDED ${loc} — shrink the handwritten regions or tighten the digest window`);
    return { code: EXIT_FINDINGS, note: `hub OVER ${loc}` };
  }
  if (b.near) console.log(`  hub budget warning ${loc} — within 5% of the hard cap`);
  return { code: EXIT_CLEAN, note: `hub ok ${loc}` };
}

/** ADJ-3b ruling C: silent hook deactivation -> explicit yellow advisory. */
function hooksProbe(): void {
  if (process.env.CI) return; // CI environments legitimately have no hooks
  let current = "";
  try { current = execSync("git config core.hooksPath", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* unset */ }
  if (current !== ".githooks") {
    console.error(
      `  [advisory] pre-commit hook NOT active: core.hooksPath is "${current || "<unset>"}", expected ".githooks".` +
        ` Fix: bash bootstrap.sh  (or: git config core.hooksPath .githooks)`,
    );
  }
}

function runLayers(mode: "check" | "sync") {
  const results = [
    rulesLinks.run(mode),
    skillsIndex.run(mode),
    memoryAggregate.run(mode),
    mcpLinks.run(mode),
    ruleRefLint.run(mode),
    skillLint.run(mode),
    constraintsIndex.run(mode),
    gateMcp.run(mode),
  ];
  return results;
}

function main(): number {
  const arg = process.argv[2] ?? "";
  const cfg = loadTargets();

  if (arg === "list" || arg === "status") {
    console.log("layers:", [...GENERATORS, ...LINTS].join(" -> "));
    for (const t of cfg.targets) {
      console.log(`  target ${t.label}: ${t.enabled ? "enabled" : "disabled (shape reserved)"}${t.rules_dir ? ` rules=${t.rules_dir} (${t.rules_mode})` : ""}${t.skills_dir ? ` skills=${t.skills_dir}` : ""}`);
    }
    console.log(`  generated_tracked: ${cfg.generated_tracked.join(", ")}`);
    console.log(`  rules_exclude_dirs: ${cfg.rules_exclude_dirs.join(", ")}`);
    console.log(`  ci: bash accessbase.sh ci  /  pixi run ci  (typecheck+lint+test+agents check, ADJ-3a ruling C)`);
    if (arg === "status") hooksProbe();
    return EXIT_CLEAN;
  }
  if (arg !== "check" && arg !== "sync" && arg !== "dry-run") {
    console.error("usage: agent-links.mts <check | sync | dry-run | list | status>");
    return 2;
  }
  const mode = arg === "sync" ? "sync" : "check";
  const results = runLayers(mode);
  const budget = hubBudgetCheck();
  const code = Math.max(...results.map((r) => r.code), budget.code);
  const tag = arg === "dry-run" ? "dry-run" : mode;
  for (const r of results) console.log(`[${tag}] ${r.summary}`);
  console.log(`[${tag}] ${budget.note}`);
  if (mode === "check") hooksProbe();
  return code;
}

process.exit(main());
