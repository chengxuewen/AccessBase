#!/usr/bin/env node
/**
 * header-lint — module status-header format + recency layer (plan
 * docs/superpowers/plans/2026-11-05-s0-s1-closeout.md wave W3; fifth lint in the
 * agent-links aggregate, ADJ-1c layering; wiring per panel C-1 two-stage rule:
 * lands REPORT-mode, the strict flip ships with the W4 exit commit — X-1=A).
 *
 * Checks per docs/modules/*.md status line (first line in the head block containing
 * "Implementation status"):
 *   E1 (error) the status line exists (absorbs the D126 grep gate).
 *   E2 (error) the line carries at least one parseable ISO date IN ANY SPELLING —
 *              `(as of …)`, `(2026-09-23 gap audit)`, `updated …` all count.
 *              (Panel round 2, R2-C1: demanding the `as of` spelling would reject
 *              every KEPT-HONEST-STALE header, reopening the C-2 hole at the
 *              parser level.)
 *   W1 (warn)  the newest date on the line is older than --window days (default
 *              45) — a triage input, never a blocker (staleness ≠ format violation).
 *   W2 (warn)  a rewritten verdict (`as of`) without an `evidence:` anchor on the
 *              same line — the §0 shape convention measured 7/7 before enforcement.
 *   Exemptions: a line carrying `superseded by` / `informational` is labelled and
 *              skipped — derived at run time from header text (D-d), no file list.
 *
 * Modes: default REPORT — findings print, summary counts, run() stays green.
 * --strict: error-level findings flip the standalone exit code to 1 (the W4-exit
 * wiring turns this on inside the check aggregate; until then nothing blocks).
 * --self-test runs SYNTHETIC in-memory fixtures ONLY (verification discipline);
 * fixture dates are built RELATIVE to today so the test set cannot rot itself.
 *
 * Exit codes follow agent-common: 0 clean / 1 findings (strict only) / 2 guard.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { EXIT_CLEAN, EXIT_FINDINGS, EXIT_GUARD, ROOT } from "./agent-common.mts";

const MODULES_DIR = path.join(ROOT, "docs", "modules");
const HEAD_SCAN_LINES = 30;

export type Finding = { file: string; level: "error" | "warn"; code: string; note: string };

function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

function newestIsoDate(line: string): string | null {
  const hits = line.match(/\d{4}-\d{2}-\d{2}/g);
  if (!hits || hits.length === 0) return null;
  return hits.sort().at(-1) as string;
}

export function lintText(text: string, name: string, windowDays: number): Finding[] {
  const out: Finding[] = [];
  const lines = text.split("\n").slice(0, HEAD_SCAN_LINES);
  const statusIdx = lines.findIndex((l) => l.includes("Implementation status"));
  if (statusIdx === -1) {
    out.push({ file: name, level: "error", code: "E1", note: "no Implementation status line in head" });
    return out;
  }
  const line = lines[statusIdx] as string;
  if (/superseded by|informational/i.test(line)) return out; // labelled exemption, never a finding
  const date = newestIsoDate(line);
  if (!date) {
    out.push({ file: name, level: "error", code: "E2", note: "status line carries no parseable ISO date (any spelling)" });
    return out;
  }
  const ageDays = Math.floor((Date.now() - Date.parse(date + "T00:00:00Z")) / 86400000);
  if (ageDays > windowDays) {
    out.push({ file: name, level: "warn", code: "W1", note: `newest date ${date} is ${ageDays} d old (> ${windowDays}) — triage input` });
  }
  if (/\bas of\b/i.test(line) && !/evidence:/i.test(line)) {
    out.push({ file: name, level: "warn", code: "W2", note: "`as of` verdict without an `evidence:` anchor" });
  }
  return out;
}

function runSelfTest(): number {
  const cases: { name: string; text: string; expect: string[] }[] = [
    { name: "clean", text: `> **Implementation status (as of ${isoDaysAgo(2)}, evidence: §1 of this file):** \`partial\``, expect: [] },
    { name: "missing-line", text: "# Some Doc\nno status here", expect: ["E1"] },
    { name: "no-date", text: "> **Implementation status:** `partial`", expect: ["E2"] },
    { name: "legacy-spelling-fresh", text: `> **Implementation status (${isoDaysAgo(5)} gap audit):** \`partial\``, expect: [] }, // R2-C1 regression
    { name: "legacy-spelling-stale", text: `> **Implementation status (${isoDaysAgo(60)} gap audit):** \`partial\``, expect: ["W1"] },
    { name: "asof-no-evidence", text: `> **Implementation status (as of ${isoDaysAgo(1)}):** \`partial\``, expect: ["W2"] },
    { name: "exempt-superseded", text: `> **Implementation status (as of ${isoDaysAgo(400)}, superseded by module X):** n/a`, expect: [] },
    { name: "guard-no-header-in-head", text: `${"x\n".repeat(HEAD_SCAN_LINES + 5)}> **Implementation status (as of ${isoDaysAgo(1)}, evidence: z):** ok` , expect: ["E1"] },
  ];
  let failed = 0;
  for (const c of cases) {
    const got = lintText(c.text, "fixture", 45).map((f) => f.code);
    const ok = got.length === c.expect.length && c.expect.every((e) => got.includes(e));
    if (!ok) {
      failed++;
      console.error(`  self-test fixture "${c.name}" expected [${c.expect.join(",") || "clean"}] got [${got.join(",")}]`);
    }
  }
  if (failed > 0) {
    console.error(`header-lint --self-test: FAIL (${failed}/${cases.length} fixtures mismatched)`);
    return EXIT_FINDINGS;
  }
  console.log(`header-lint --self-test: PASS (${cases.length} fixtures: E1/E2 red, legacy spellings accepted per R2-C1, W1/W2 warn, exemption skipped, deep-line guard)`);
  return EXIT_CLEAN;
}

export function run(_mode: "check" | "sync"): { code: number; summary: string } {
  if (!existsSync(MODULES_DIR)) return { code: EXIT_GUARD, summary: "docs/modules missing (guard, nothing read elsewhere)" };
  const files = readdirSync(MODULES_DIR).filter((f) => f.endsWith(".md"));
  const findings: Finding[] = [];
  for (const f of files) {
    try {
      findings.push(...lintText(readFileSync(path.join(MODULES_DIR, f), "utf8"), f, 45));
    } catch (e) {
      return { code: EXIT_GUARD, summary: `header-lint read failed on ${f}: ${(e as Error).message}` };
    }
  }
  const errors = findings.filter((x) => x.level === "error");
  const warns = findings.filter((x) => x.level === "warn");
  // STRICT (flipped at the W4-exit commit 2026-11-06, ruled X-1=A; R2-C3 precondition
  // met: 0 errors repo-wide measured immediately before the flip, verified via --strict
  // exit 0). error-level findings block via agents check => pre-commit + CI double
  // harness. warns NEVER block (C-2 severity split: staleness is a triage input).
  for (const x of findings) console.log(`  header-lint ${x.level.toUpperCase()} ${x.file}: [${x.code}] ${x.note}`);
  return {
    code: errors.length > 0 ? EXIT_FINDINGS : EXIT_CLEAN,
    summary: `header-lint strict: ${errors.length} error, ${warns.length} warn over ${files.length} files`,
  };
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) process.exit(runSelfTest());
// "sync" arrives as argv from the dispatcher (caught live by the pre-commit gate on
// this very layer's first commit - lints have no repair behavior, sync === check here)
if (args.length === 0 || args[0] === "check" || args[0] === "sync" || args[0] === "--strict") {
  const r = run("check");
  console.log(r.summary);
  if (r.code !== EXIT_CLEAN) process.exit(r.code); // guard stays guard in every mode
  process.exit(args.includes("--strict") && strictExitWithErrors() ? EXIT_FINDINGS : EXIT_CLEAN);
}
console.error("usage: header-lint.mts [--self-test | check | --strict]");
process.exit(EXIT_GUARD);

function strictExitWithErrors(): boolean {
  // separate pass so the aggregate run() keeps its report-only contract (C-1)
  if (!existsSync(MODULES_DIR)) return false;
  const files = readdirSync(MODULES_DIR).filter((f) => f.endsWith(".md"));
  return files.some((f) =>
    lintText(readFileSync(path.join(MODULES_DIR, f), "utf8"), f, 45).some((x) => x.level === "error"),
  );
}
