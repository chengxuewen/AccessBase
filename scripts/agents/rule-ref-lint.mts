#!/usr/bin/env node
/**
 * rule-ref-lint — C/D/PIT reference resolution layer (plan Batch 1; absorbed
 * into the `agents check` aggregate at Batch 3 — ADJ-1c ruling B, no re-homing).
 *
 * Checks:
 *   1. Dangling references — bare C{n} / D{n} / PIT-{n} cited in the governance
 *      prose surface must have a definition in .agents/memorys/.
 *   2. Duplicate definitions — same number defined twice in one memory file is
 *      a hard finding (VE D54/D55 concurrent-numbering lesson).
 *
 * Cross-repo citations with an `MS:` / `VE:` / `RCH:` prefix are exempt
 * (ADJ-1b ruling A). PIT-001 and PIT-1 are the same number (zeros stripped).
 * Explanatory mentions must not use the bare citation shape (discovered live
 * 2026-11-04 — see lesson-memory.md Numbering discipline).
 *
 * Exit codes: 0 clean / 1 findings / 2 internal guard (nothing written).
 * --self-test runs on synthetic fixtures ONLY (verification discipline).
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { EXIT_CLEAN, EXIT_FINDINGS, ROOT } from "./agent-common.mts";

const MEMORY_DIR = path.join(ROOT, ".agents", "memorys");
const MEMORY_FILES: Record<Kind, string> = { D: "decisions.md", PIT: "pitfalls.md", C: "conventions.md" };

type Kind = "D" | "PIT" | "C";
type Defs = Record<Kind, Set<string>>;

// --- reusable core (consumed by skill-lint layer) --------------------------

export function stripPrefixed(text: string): string {
  // "VE:D47", "MS:PIT-65", "RCH:C10", "RCH:PIT-250" — prefix glued to the
  // number token (D / C / PIT- followed by digits, per ADJ-1b).
  return text.replace(/(?:MS|VE|RCH):(?:(?:PIT-)?[DC]?\d+)/g, "");
}

function citationPattern(kind: Kind): RegExp {
  if (kind === "PIT") return /\bPIT-(\d+)\b/g;
  if (kind === "D") return /\bD(\d+)\b/g;
  return /\bC(\d+)\b/g;
}

function defPattern(kind: Kind): RegExp {
  if (kind === "D") return /^##[ \t]+D(\d+):/gm;
  if (kind === "PIT") return /^##[ \t]+PIT-(\d+):/gm;
  return /^##[ \t]+C(\d+):/gm; // future C numbering picked up automatically
}

/** Load the three memory files and extract number sets + duplicate collisions. */
export function collectDefs(memorysRoot: string): Defs & { duplicatesOf(kind: Kind): string[] } {
  const defs = { D: new Set<string>(), PIT: new Set<string>(), C: new Set<string>() } as Defs;
  const dupMessages: Record<Kind, string[]> = { D: [], PIT: [], C: [] };
  for (const kind of ["D", "PIT", "C"] as Kind[]) {
    const file = path.join(memorysRoot, MEMORY_FILES[kind]);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const seen = new Map<string, number[]>();
    for (const m of text.matchAll(defPattern(kind))) {
      const num = String(Number(m[1]));
      defs[kind].add(num);
      const line = text.slice(0, m.index ?? 0).split("\n").length;
      seen.set(num, [...(seen.get(num) ?? []), line]);
    }
    for (const [num, lines] of seen) {
      if (lines.length > 1) dupMessages[kind].push(`${MEMORY_FILES[kind]} — ${kind === "PIT" ? `PIT-${num}` : `${kind}${num}`} defined twice (lines ${lines.join(", ")}) — concurrent numbering collision`);
    }
  }
  return Object.assign(defs, { duplicatesOf: (kind: Kind) => dupMessages[kind] });
}

/** Scan one text for dangling bare citations; returns finding strings. */
export function scanTextForDangling(text: string, defs: Defs, label: string): string[] {
  const out: string[] = [];
  const cleaned = stripPrefixed(text);
  for (const kind of ["PIT", "D", "C"] as Kind[]) {
    const reported = new Map<string, number[]>();
    for (const m of cleaned.matchAll(citationPattern(kind))) {
      const num = String(Number(m[1]));
      if (defs[kind].has(num)) continue;
      const line = cleaned.slice(0, m.index ?? 0).split("\n").length;
      const lines = reported.get(num) ?? [];
      if (!lines.includes(line)) lines.push(line);
      reported.set(num, lines);
    }
    for (const [num, lines] of reported) {
      out.push(`${label}:${lines.join(",")} — ${kind === "PIT" ? `PIT-${num}` : `${kind}${num}`} has no definition in .agents/memorys/${MEMORY_FILES[kind]}`);
    }
  }
  return out;
}

// --- layer + CLI -----------------------------------------------------------

function collectMarkdown(dir: string): string[] {
  const out: string[] = [];
  const SKIP = new Set(["node_modules", "__pycache__", ".pixi"]);
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectMarkdown(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

export function run(_mode: "check" | "sync"): { code: number; summary: string } {
  const defs = collectDefs(MEMORY_DIR);
  const scanFiles: Array<{ label: string; text: string }> = [];
  const targets: Array<[string, boolean]> = [
    [path.join(ROOT, ".agents", "rules"), false],
    [path.join(ROOT, ".agents", "skills"), false],
    [path.join(ROOT, "CONSTRAINTS.md"), true],
    [path.join(ROOT, "AGENTS.md"), true],
  ];
  for (const [p, optional] of targets) {
    if (!existsSync(p)) {
      if (optional) continue;
      console.error(`rule-ref-lint: guard — required scan target missing: ${p}`);
      process.exit(2);
    }
    if (statSync(p).isDirectory()) {
      for (const f of collectMarkdown(p)) scanFiles.push({ label: path.relative(ROOT, f), text: readFileSync(f, "utf8") });
    } else scanFiles.push({ label: path.basename(p), text: readFileSync(p, "utf8") });
  }
  const findings = scanFiles.flatMap((f) => scanTextForDangling(f.text, defs, f.label));
  for (const kind of ["D", "PIT", "C"] as Kind[]) findings.push(...defs.duplicatesOf(kind));

  if (findings.length === 0) return { code: EXIT_CLEAN, summary: "rule-ref-lint: clean" };
  console.log(`rule-ref-lint: ${findings.length} finding(s)`);
  for (const f of findings) console.log(`  [dangling] ${f}`);
  console.log("  fix: define the number, correct the citation, or prefix cross-repo numbers with MS:/VE:/RCH: (ADJ-1b)");
  return { code: EXIT_FINDINGS, summary: `rule-ref-lint: ${findings.length} finding(s)` };
}

/** Synthetic fixtures only — never touches real files. */
function runSelfTest(): number {
  const defs = { D: new Set(["1", "54"]), PIT: new Set(["1", "12"]), C: new Set(["3"]) } as Defs;
  const dupDefs = { ...defs, duplicatesOf: (_name: string) => ["decisions.md — D54 defined twice (lines 3, 5)"] };
  const body =
    "Refs D1 (ok), D999 (dangling), PIT-001 (ok), PIT-99999 (dangling), C3 (ok), C7 (dangling).\n" +
    "Exempt: VE:D47 and MS:PIT-65 and RCH:PIT-250 and RCH:C10 must NOT fire.\n";
  const dangling = scanTextForDangling(body, defs, "fixture.md");
  const expect = ["D999", "PIT-99999", "C7"];
  const missing = expect.filter((t) => !dangling.some((d) => d.includes(t)));
  const leaked = dangling.filter((d) => /VE:|MS:|RCH:/.test(d));
  const dupOk = dupDefs.duplicatesOf("D").some((d) => d.includes("D54"));
  if (missing.length || leaked.length || !dupOk) {
    console.error("rule-ref-lint --self-test: FAIL (detector failed to go red)");
    if (missing.length) console.error(`  not detected: ${missing.join(", ")}`);
    if (leaked.length) console.error(`  exemption leaked: ${leaked.join("; ")}`);
    return 1;
  }
  console.log("rule-ref-lint --self-test: PASS (red on D999/PIT-99999/C7; prefixes exempt; duplicate D54 caught)");
  return 0;
}

if (import.meta.main) {
  const arg = process.argv[2] ?? "";
  if (arg === "--self-test") process.exit(runSelfTest());
  if (arg !== "" && arg !== "check") { console.error("usage: rule-ref-lint.mts [--self-test | check]"); process.exit(2); }
  process.exit(run("check").code);
}
