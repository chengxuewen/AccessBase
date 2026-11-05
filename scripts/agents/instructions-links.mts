/**
 * instructions-links — .agents/rules/** (excl. zh/, excl. README) + memory
 * files + CONSTRAINTS.md → .opencode/opencode.json `instructions[]`
 * (plan Batch 8; ADJ-OC-1/2/3/4).
 *
 * ADJ-OC-1: the handwritten 19-entry list sat outside every generator and
 * check — Batch 4's tool-routing.md silently never reached OpenCode. The face
 * is a FULL REWRITE (RCH D20: additive merge cannot reclaim removed entries).
 * Register rule sources in .agents/, never hand-edit this key.
 * ADJ-OC-2: full rules layer (79, excl. zh/; collectRules already excludes the
 * top-level README) + the two registry-declared memory files + CONSTRAINTS.md
 * FIRST (ADJ-OC-4). Per-turn cost (~291KB measured 2026-11-04) is knowingly
 * bought — OpenCode instructions are always-on full-text injection.
 * ADJ-OC-3: budget is warn-only — the size line prints on every clean run (via
 * the summary; on drift the layer returns before it); WARN past
 * budget_warn_bytes; NEVER affects the exit code.
 * ADJ-OC-4: CONSTRAINTS.md is a fixed first entry, path from the registry
 * `constraints_hub` field.
 *
 * Ordering: deterministic plain sort() (UTF-16 code units) on the rule paths;
 * fixed prefix [CONSTRAINTS.md, ...memory_files] in registry order. Never
 * localeCompare (ICU drift = churn).
 */

import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import {
  ROOT, loadTargets, EXIT_CLEAN, EXIT_FINDINGS, writeIfChanged,
  collectRules, deepEqual, type Targets,
} from "./agent-common.mts";

const OPENCODE = path.join(ROOT, ".opencode", "opencode.json");

function wantInstructions(cfg: Targets): string[] {
  const face = cfg.targets.find((t) => t.label === "opencode" && t.enabled)?.instructions_face;
  if (!face) return [];
  const rulesRoot = path.join(ROOT, cfg.rules_root);
  const rules = collectRules(rulesRoot, cfg.rules_exclude_dirs)
    .map((r) => path.relative(ROOT, r.src).split(path.sep).join("/"))
    .filter((p) => path.posix.basename(p) !== "README.md")
    .sort();
  return [cfg.constraints_hub, ...face.memory_files, ...rules];
}

export function run(mode: "check" | "sync"): { code: number; summary: string } {
  const cfg = loadTargets();
  const target = cfg.targets.find((t) => t.label === "opencode" && t.enabled);
  const face = target?.instructions_face;
  if (!target || !face) return { code: EXIT_CLEAN, summary: "instructions-links: no enabled opencode instructions_face, skip" };

  const want = wantInstructions(cfg);

  // Missing source = finding on BOTH modes (a sync over missing files would
  // either crash mid-read or write a face pointing at absent files).
  const missing = want.filter((p) => !existsSync(path.join(ROOT, p)));
  if (missing.length > 0) {
    console.error("instructions-links: source files missing — restore them or fix the registry:");
    for (const m of missing) console.error(`  ${m}`);
    return { code: EXIT_FINDINGS, summary: `instructions-links: ${missing.length} source file(s) missing` };
  }

  const doc = JSON.parse(readFileSync(OPENCODE, "utf8")) as Record<string, unknown>;
  if (mode === "sync") {
    doc.instructions = want;
    writeIfChanged(OPENCODE, JSON.stringify(doc, null, 2) + "\n");
  } else if (!deepEqual(doc.instructions, want)) {
    console.log("instructions-links: instructions[] drifted (hand-written entries, or sources changed without sync — RCH D20: this key is generated; register sources in .agents/)");
    const prevArr = Array.isArray(doc.instructions) ? doc.instructions : [];
    const wantSet = new Set(want);
    for (const e of prevArr) if (typeof e === "string" && !wantSet.has(e)) console.log(`  orphan entry: ${e}`);
    for (const e of want) if (!(prevArr as string[]).includes(e)) console.log(`  missing entry: ${e}`);
    return { code: EXIT_FINDINGS, summary: "instructions-links: drift" };
  }

  // ADJ-OC-3: warn-only budget line — prints on clean runs, never touches code.
  const contents = want.map((p) => readFileSync(path.join(ROOT, p), "utf8"));
  const chars = contents.reduce((n, c) => n + [...c].length, 0);
  const bytes = contents.reduce((n, c) => n + Buffer.byteLength(c, "utf8"), 0);
  const loc = `(${want.length} entries / ${chars} chars / ${bytes} bytes; warn ${face.budget_warn_bytes})`;
  if (bytes > face.budget_warn_bytes) {
    console.log(`  instructions budget WARNING ${loc} — load cost is knowingly bought (ADJ-OC-2); act only if it keeps growing`);
  }
  return mode === "sync"
    ? { code: EXIT_CLEAN, summary: `instructions-links: face written ${loc}` }
    : { code: EXIT_CLEAN, summary: `instructions-links: clean ${loc}` };
}
