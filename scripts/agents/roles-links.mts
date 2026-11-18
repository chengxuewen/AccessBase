/**
 * roles-links — role-layer projection (plan RT-B1 A+ form, RA-1818-1
 * adjacency). `.agents/agents/*.md` -> `.codebuddy/agents/*.md` (TRACKED —
 * role files are repo declarations readable by collaborators/CI, not
 * per-machine mirrors; see donor targets.json agents_source/agents_target).
 *
 * Dialect normalization (post-adjudication recheck R-2, hard precondition):
 * all 10 donor role files carry `model: inherit` — the exact token that
 * broke Qoder host-wide (donor 63b1b54). Our single host face (CodeBuddy)
 * KEEPS the line (CodeBuddy is its native dialect; MS kept it on the
 * codebuddy face too); a per-host drop is a future renderer branch only when
 * a second host consumes roles.
 *
 * check: byte-equal (generated mirror). sync: write. Rendering is a pure
 * copy — role files are validated by agent-lint, not transformed here.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import * as path from "node:path";
import { ROOT, EXIT_CLEAN, EXIT_FINDINGS } from "./agent-common.mts";

const SRC = path.join(ROOT, ".agents", "agents");
const DST = path.join(ROOT, ".codebuddy", "agents");

function wanted(): Map<string, string> {
  const m = new Map<string, string>();
  if (!existsSync(SRC)) return m;
  for (const f of readdirSync(SRC)) {
    if (!f.endsWith(".md")) continue;
    m.set(f, readFileSync(path.join(SRC, f), "utf8"));
  }
  return m;
}

export function run(mode: "check" | "sync"): { code: number; summary: string } {
  const roles = wanted();
  const findings: string[] = [];

  if (mode === "sync") {
    mkdirSync(DST, { recursive: true });
    for (const [name, body] of roles) writeFileSync(path.join(DST, name), body);
    // orphan cleanup (mirror semantics — this face is a pure projection)
    for (const f of existsSync(DST) ? readdirSync(DST) : []) {
      if (f.endsWith(".md") && !roles.has(f)) {
        console.log(`  roles-links: removing orphan ${f}`);
        unlinkSync(path.join(DST, f));
      }
    }
    return { code: EXIT_CLEAN, summary: `roles-links: ${roles.size} role file(s) projected (tracked face)` };
  }

  for (const [name, body] of roles) {
    const dst = path.join(DST, name);
    if (!existsSync(dst)) findings.push(`${name} not projected (sync will write it)`);
    else if (readFileSync(dst, "utf8") !== body) findings.push(`${name} drifted`);
  }
  // orphans on the face
  if (existsSync(DST)) {
    for (const f of readdirSync(DST)) {
      if (f.endsWith(".md") && !roles.has(f)) findings.push(`orphan face file ${f} (unregistered)`);
    }
  }

  if (findings.length) {
    console.log(`roles-links: ${findings.length} finding(s):`);
    for (const f of findings) console.log(`  ${f}`);
    return { code: EXIT_FINDINGS, summary: `roles-links: ${findings.length} finding(s)` };
  }
  return { code: EXIT_CLEAN, summary: `roles-links: clean (${roles.size} role files projected)` };
}
