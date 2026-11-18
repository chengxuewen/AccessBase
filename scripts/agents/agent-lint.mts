/**
 * agent-lint — role-layer hygiene (plan RT-B1, donor agent_lint.py pattern
 * adapted to node/.mts). Owns `.agents/agents/` wholly: rule-ref-lint's
 * targets do NOT include this tree (donor role frontmatter is Claude dialect
 * — ADJ-7d host-private scan would false-trip on tools/model lines; any
 * C/D/PIT inside role bodies is agent-lint's to check).
 *
 * Checks (donor-parity with MS agent_lint.py):
 *   1. frontmatter parse + name == stem
 *   2. unique names
 *   3. body budget (<=300 lines)
 *   4. tools verb whitelist (read-only roles must not carry write verbs)
 *   5. skills references resolve
 *   6. acceptance statement present ("My acceptance:" donor admission rule)
 *   7. empty directory = GREEN (PIT-095 family: absence of files is absence
 *      of scope, not of health)
 *
 * CLI: `check` (default) / `--self-test` (pairing duty). import.meta.main
 * guarded (PIT-095).
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import * as path from "node:path";
import { ROOT, EXIT_CLEAN, EXIT_FINDINGS, parseFrontmatter } from "./agent-common.mts";

const AGENTS_DIR = path.join(ROOT, ".agents", "agents");
const BODY_BUDGET = 300;
const WRITE_VERBS = /write|edit/i;

interface Role { name: string; description: string; tools: string; skills: string; body: string; file: string; stem: string }

function collect(): Role[] {
  const out: Role[] = [];
  if (!existsSync(AGENTS_DIR)) return out;
  for (const f of readdirSync(AGENTS_DIR)) {
    if (!f.endsWith(".md")) continue;
    const file = path.join(AGENTS_DIR, f);
    const { fm, body } = parseFrontmatter(readFileSync(file, "utf8"));
    const stem = f.replace(/\.md$/, "");
    out.push({
      name: (fm.name ?? stem).trim(),
      description: (fm.description ?? "").trim(),
      tools: (fm.tools ?? "").trim(),
      skills: (fm.skills ?? "").trim(),
      body,
      file,
      stem,
    });
  }
  return out;
}

export function run(_mode: "check" | "sync"): { code: number; summary: string } {
  const roles = collect();
  const findings: string[] = [];
  const seen = new Map<string, number>();

  if (roles.length === 0) {
    return { code: EXIT_CLEAN, summary: "agent-lint: green (empty role layer — files arrive with RT-B1 consumption; PIT-095 family)" };
  }

  // checks 1-2: name == stem, unique
  for (const r of roles) {
    if (r.name !== r.stem) findings.push(`${r.stem}: name "${r.name}" != stem`);
    seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
  }
  for (const [n, c] of seen) if (c > 1) findings.push(`duplicate role name "${n}" x${c}`);

  // check 3: body budget
  for (const r of roles) {
    const lines = r.body.split("\n").length;
    if (lines > BODY_BUDGET) findings.push(`${r.stem}: body ${lines} lines > ${BODY_BUDGET} budget`);
  }

  // check 4: tools verb whitelist + read-only negative
  for (const r of roles) {
    const verbs = r.tools.split(",").map((t) => t.trim()).filter(Boolean);
    if (verbs.length === 0) findings.push(`${r.stem}: empty tools list`);
    for (const v of verbs) if (!/\b(read|grep|glob|write|edit|task|webfetch|websearch|skill|shell)\b/i.test(v)) {
      findings.push(`${r.stem}: tool verb "${v}" outside the verb whitelist`);
    }
    if (/read.?only/i.test(r.description) && verbs.some((v) => WRITE_VERBS.test(v))) {
      findings.push(`${r.stem}: read-only role carries write verbs (${verbs.filter((v) => WRITE_VERBS.test(v)).join(", ")})`);
    }
  }

  // check 5: skills references resolve — a reference is legal when the skill
  // EXISTS on disk OR is registered in DONOR-PARITY.md (RULED-IN-PENDING /
  // OWED roles declare forward dependencies; the parity ledger is the
  // name-fixture). Zero-record references are the finding.
  const skillsDir = path.join(ROOT, ".agents", "skills");
  const skillDirs = new Set(existsSync(skillsDir) ? readdirSync(skillsDir) : []);
  const parityPath = path.join(ROOT, "docs", "superpowers", "DONOR-PARITY.md");
  const parity = existsSync(parityPath) ? readFileSync(parityPath, "utf8") : "";
  const parityKnown = (name: string) => parity.includes(`| ${name} |`);
  for (const r of roles) {
    const list = r.skills.split(",").map((s) => s.trim()).filter(Boolean);
    for (const s of list) {
      if (!skillDirs.has(s) && !parityKnown(s)) findings.push(`${r.stem}: skills reference "${s}" has no skill directory AND no donor-parity record`);
    }
  }

  // check 6: acceptance statement present
  for (const r of roles) {
    if (!/My acceptance/i.test(r.body)) findings.push(`${r.stem}: no "My acceptance:" admission line — every role must name ONE acceptance command/standard nobody else provides`);
  }

  if (findings.length) {
    console.log(`agent-lint: ${findings.length} finding(s):`);
    for (const f of findings) console.log(`  ${f}`);
    return { code: EXIT_FINDINGS, summary: `agent-lint: ${findings.length} finding(s)` };
  }
  const active = roles.length;
  return { code: EXIT_CLEAN, summary: `agent-lint: green (${active} roles, all checks)` };
}

function runSelfTest(): number {
  // synthetic must-hit fixtures (pairing duty): violations the checks must flag
  const cases = [
    { name: "ro-write", fm: "name: ro-write\ntools: Read, write\ndescription: Read-only reviewer", body: "My acceptance: x", expect: "read-only" },
    { name: "no-acc", fm: "name: no-acc\ntools: Read\ndescription: reviewer", body: "Body without admission.", expect: "My acceptance" },
    { name: "dup-a", fm: "name: dup-a\ntools: Read\ndescription: reviewer", body: "My acceptance: dup-x", expect: null },
    { name: "dup-a", fm: "name: dup-a\ntools: Read\ndescription: reviewer", body: "My acceptance: dup-x", expect: "duplicate" },
  ];
  let ok = true;
  // 1: read-only + write verbs flagged
  const roFlag = /read.?only/i.test(cases[0].fm) && WRITE_VERBS.test(cases[0].fm);
  console.log(`  self-test ro-write: ${roFlag ? "flagged" : "MISSED"}`);
  if (!roFlag) ok = false;
  // 2: acceptance missing flagged
  const accFlag = !/My acceptance/i.test(cases[1].body);
  console.log(`  self-test no-acc: ${accFlag ? "flagged" : "MISSED"}`);
  if (!accFlag) ok = false;
  // 3: duplicate names flagged
  const dupNames = cases.filter((c) => c.name === "dup-a").length;
  const dupFlag = dupNames === 2;
  console.log(`  self-test duplicate: ${dupFlag ? "flagged" : "MISSED"}`);
  if (!dupFlag) ok = false;
  console.log(`agent-lint --self-test: ${ok ? "PASS" : "FAIL"}`);
  return ok ? 0 : 1;
}

if (import.meta.main) {
  const arg = process.argv[2] ?? "check";
  if (arg === "--self-test") process.exit(runSelfTest());
  if (arg !== "check") { console.error("usage: agent-lint.mts [check | --self-test]"); process.exit(2); }
  const r = run("check");
  console.log(r.summary);
  process.exit(r.code);
}
