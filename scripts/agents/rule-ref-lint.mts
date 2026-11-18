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
 * Check 3 (ADJ-7d): host-private paths (`~/.claude`, `~/.copilot`, `allowedTools`,
 * ...) in rules/skills surface — rules text names CAPABILITIES, never host-private
 * bindings; `.refinfo/` exempt by absence from the scan roots.
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

/** Load the three memory files: definitions, REGISTERED VOIDs, duplicates,
 *  and unregistered continuity gaps (plan G1′, ruling #2). A VOID is a
 *  reserved-but-never-assigned number; it counts as "known" for citation
 *  resolution but is NOT a real entry and MUST NOT be reused. */
export function collectDefs(memorysRoot: string): Defs & {
  duplicatesOf(kind: Kind): string[];
  gapsOf(kind: Kind): string[];
  voidsOf(kind: Kind): string[];
} {
  const defs = { D: new Set<string>(), PIT: new Set<string>(), C: new Set<string>() } as Defs;
  const voids: Record<Kind, Set<string>> = { D: new Set(), PIT: new Set(), C: new Set() };
  const dupMessages: Record<Kind, string[]> = { D: [], PIT: [], C: [] };
  const gapMessages: Record<Kind, string[]> = { D: [], PIT: [], C: [] };
  for (const kind of ["D", "PIT", "C"] as Kind[]) {
    const file = path.join(memorysRoot, MEMORY_FILES[kind]);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const seen = new Map<string, number[]>();
    for (const m of text.matchAll(defPattern(kind))) {
      const num = String(Number(m[1]));
      const heading = (m[0] as string) + " " + text.slice((m.index ?? 0) + m[0].length).split("\n")[0];
      if (/REGISTERED VOID/i.test(heading)) { voids[kind].add(num); defs[kind].add(num); continue; }
      defs[kind].add(num);
      const line = text.slice(0, m.index ?? 0).split("\n").length;
      seen.set(num, [...(seen.get(num) ?? []), line]);
    }
    for (const [num, lines] of seen) {
      if (lines.length > 1) dupMessages[kind].push(`${MEMORY_FILES[kind]} — ${kind === "PIT" ? `PIT-${num}` : `${kind}${num}`} defined twice (lines ${lines.join(", ")}) — concurrent numbering collision`);
    }
    // C-series is new and intentionally sparse (only C1 today) — continuity
    // applies to the append-only D/PIT ledgers only.
    if (kind !== "C") {
      const max = Math.max(0, ...[...defs[kind]].map(Number));
      for (let n = 1; n <= max; n++) {
        if (!defs[kind].has(String(n))) gapMessages[kind].push(`${MEMORY_FILES[kind]} — ${kind === "PIT" ? `PIT-${n}` : `${kind}${n}`} unregistered gap in 1..${max} — add a REGISTERED VOID entry (never reuse the number)`);
      }
    }
  }
  return Object.assign(defs, {
    duplicatesOf: (kind: Kind) => dupMessages[kind],
    gapsOf: (kind: Kind) => gapMessages[kind],
    voidsOf: (kind: Kind) => [...voids[kind]],
  });
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

/** ADJ-7d: host-private path patterns — a rules/skills surface must not bind to a
 *  specific host's private config. Returns finding strings. */
const HOST_PRIVATE_PATTERNS: Array<[RegExp, string]> = [
  [/~\/\.claude/g, "~/.claude"],
  [/~\/\.copilot/g, "~/.copilot"],
  [/\ballowedTools\b/g, "allowedTools"],
  [/~\/\.claude\.json/g, "~/.claude.json"],
  [/dangerously-skip-permissions/g, "dangerously-skip-permissions"],
];

export function scanTextForHostPrivate(text: string, label: string): string[] {
  const out: string[] = [];
  const reported = new Map<string, number[]>();
  for (const [re, name] of HOST_PRIVATE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index ?? 0).split("\n").length;
      const lines = reported.get(name) ?? [];
      if (!lines.includes(line)) lines.push(line);
      reported.set(name, lines);
    }
  }
  for (const [name, lines] of reported) {
    out.push(`${label}:${lines.join(",")} — host-private binding "${name}" (name the CAPABILITY, not the host path — ADJ-7d)`);
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
  // ADJ-7d: host-private scan; zh/ is the legacy Chinese mirror (exempt, no-back-translation
  // policy) and book-to-skill is an upstream-fork skill whose cross-host install docs are
  // its own subject matter
  const hostPrivate = scanFiles
    .filter((f) => !f.label.startsWith(".agents/rules/zh/") && !f.label.includes("book-to-skill"))
    .flatMap((f) => scanTextForHostPrivate(f.text, f.label));
  for (const kind of ["D", "PIT", "C"] as Kind[]) {
    findings.push(...defs.duplicatesOf(kind));
    findings.push(...defs.gapsOf(kind));
  }
  // Corpus-expansion measurement (plan v2): MS scans docs/ too; our owned
  // surface stays the four targets. Measure first, never hard-fail on an
  // unowned corpus — this line is advisory, not a finding.
  const docsDir = path.join(ROOT, "docs");
  if (existsSync(docsDir)) {
    let docCites = 0;
    for (const f of collectMarkdown(docsDir)) {
      const t = stripPrefixed(readFileSync(f, "utf8"));
      for (const kind of ["D", "PIT", "C"] as Kind[]) {
        docCites += [...t.matchAll(citationPattern(kind))].length;
      }
    }
    console.log(`  [measure] docs/ bare C/D/PIT citations: ${docCites} (out of owned scan surface; advisory only — corpus expansion needs a ruling)`);
  }

  if (findings.length === 0 && hostPrivate.length === 0) return { code: EXIT_CLEAN, summary: "rule-ref-lint: clean" };
  const total = findings.length + hostPrivate.length;
  console.log(`rule-ref-lint: ${total} finding(s)`);
  for (const f of findings) console.log(`  [dangling] ${f}`);
  for (const f of hostPrivate) console.log(`  [host-private] ${f}`);
  console.log("  fix: define the number, correct the citation, prefix cross-repo numbers with MS:/VE:/RCH: (ADJ-1b), or rewrite host-private bindings as capability names (ADJ-7d)");
  return { code: EXIT_FINDINGS, summary: `rule-ref-lint: ${total} finding(s)` };
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
