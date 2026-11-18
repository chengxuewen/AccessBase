/**
 * scripts-lint — operational-script hygiene (plan G1′, MS B14 pattern).
 *
 * Two distinct strengths, deliberately different:
 *   1. Syntax is a HARD gate: every operational script must parse
 *      (bash -n / node --check with type-stripping for .mts / ast.parse for .py).
 *      A script with broken syntax is dead weight that fails only when called.
 *   2. Orphans are WARN-ONLY (audits propose, never execute): a script whose
 *      basename appears NOWHERE in the reference corpus (accessbase.sh,
 *      pixi.toml, AGENTS.md, docs/, memorys, CONSTRAINTS.md, package.json,
 *      workflows) is reported on stderr but never reddens the chain. The
 *      sanctioned fix is to REGISTER its purpose in AGENTS.md's Operational
 *      scripts table — not to delete it on a script's say-so.
 *
 * The scripts/agents/ subtree is out of scope: those are governance-layer
 * modules, all imported by agent-links.mts (the dispatcher itself is their
 * single reference).
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { ROOT, EXIT_CLEAN, EXIT_FINDINGS } from "./agent-common.mts";

const SCRIPTS = path.join(ROOT, "scripts");
const OPS_EXT = /\.(sh|mjs|mts|ts|py)$/;

function collectScripts(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === "agents") continue; // governance subtree, separately governed
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) out.push(...collectScripts(full));
    else if (OPS_EXT.test(e)) out.push(full);
  }
  return out;
}

function syntaxCheck(file: string): string | null {
  const ext = path.extname(file);
  const args =
    ext === ".sh" ? ["-n", file] :
    ext === ".mts" ? ["--experimental-strip-types", "--check", file] :
    ext === ".py" ? ["-c", `import ast,sys; ast.parse(open(sys.argv[1],encoding='utf8').read())`, file] :
    ["--check", file];
  const cmd = ext === ".sh" ? "bash" : ext === ".py" ? "python3" : process.execPath;
  try { execFileSync(cmd, args, { cwd: ROOT, stdio: "pipe" }); return null; }
  catch (e) {
    const err = e as { stderr?: Buffer };
    return `${path.relative(ROOT, file)}: ${(err.stderr?.toString() ?? "syntax error").split("\n")[0]}`;
  }
}

/** Reference corpus: text files that would legitimately call out a script. */
function referenceCorpus(): string {
  const files = [
    "accessbase.sh", "pixi.toml", "AGENTS.md", "CONSTRAINTS.md", "package.json",
    ".agents/memorys/status.md", ".agents/memorys/conventions.md",
  ];
  let corpus = "";
  for (const f of files) if (existsSync(path.join(ROOT, f))) corpus += readFileSync(path.join(ROOT, f), "utf8") + "\n";
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(md|yml|yaml|ts|tsx|json|mts|mjs)$/.test(e)) corpus += readFileSync(full, "utf8") + "\n";
    }
  };
  walk(path.join(ROOT, "docs"));
  walk(path.join(ROOT, ".github", "workflows"));
  return corpus;
}

export function run(_mode: "check" | "sync"): { code: number; summary: string } {
  const scripts = collectScripts(SCRIPTS);
  const errors: string[] = [];
  for (const f of scripts) {
    const err = syntaxCheck(f);
    if (err) errors.push(err);
  }
  const corpus = referenceCorpus();
  const orphans: string[] = [];
  for (const f of scripts) {
    const base = path.basename(f);
    if (!corpus.includes(base)) orphans.push(path.relative(ROOT, f));
  }
  for (const o of orphans) console.log(`  [orphan WARN] ${o} — register its purpose in AGENTS.md Operational scripts (audit proposes, never deletes)`);

  if (errors.length) {
    console.log(`scripts-lint: ${errors.length} syntax error(s):`);
    for (const e of errors) console.log(`  ${e}`);
    return { code: EXIT_FINDINGS, summary: `scripts-lint: ${errors.length} syntax error(s)` };
  }
  return {
    code: EXIT_CLEAN,
    summary: `scripts-lint: ${scripts.length} scripts parse clean; ${orphans.length} orphan WARN (non-blocking)`,
  };
}

/** Parse a source string without writing a file (self-test use). */
function syntaxCheckFromText(text: string, ext: string): string | null {
  try {
    if (ext === ".sh") execFileSync("bash", ["-n"], { input: text, cwd: ROOT, stdio: "pipe" });
    else if (ext === ".py") execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: text, cwd: ROOT, stdio: "pipe" });
    else execFileSync(process.execPath, ["--check"], { input: text, cwd: ROOT, stdio: "pipe" });
    return null;
  } catch (e) {
    return (e as { stderr?: Buffer }).stderr?.toString().split("\n")[0] ?? "syntax error";
  }
}

/** Synthetic must-hit fixtures — never touch real files (self-test pairing duty). */
function runSelfTest(): number {
  const corpus = "pixi run check-refs && bash accessbase.sh agents check\n";
  const detectsOrphan = !corpus.includes("ghost-script-xyz.sh");
  const detectsLive = corpus.includes("check-refs");
  const detectsBadSyntax = syntaxCheckFromText("echo 'unterminated\n", ".sh") !== null;
  const detectsGoodSyntax = syntaxCheckFromText("echo ok\n", ".sh") === null;
  if (detectsOrphan && detectsLive && detectsBadSyntax && detectsGoodSyntax) {
    console.log("scripts-lint --self-test: PASS (ghost orphan flagged, live name found, bad bash RED, good bash GREEN)");
    return 0;
  }
  console.error("scripts-lint --self-test: FAIL (detector failed to go red/green)");
  if (!detectsOrphan) console.error("  ghost orphan not flagged");
  if (!detectsLive) console.error("  live name not found");
  if (!detectsBadSyntax) console.error("  broken bash not red");
  if (!detectsGoodSyntax) console.error("  valid bash not green");
  return 1;
}

if (import.meta.main) {
  const arg = process.argv[2] ?? "check";
  if (arg === "--self-test") process.exit(runSelfTest());
  if (arg !== "check") { console.error("usage: scripts-lint.mts [check | --self-test]"); process.exit(2); }
  const r = run("check");
  console.log(r.summary);
  process.exit(r.code);
}
