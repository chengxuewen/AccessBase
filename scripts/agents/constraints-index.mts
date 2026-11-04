/**
 * constraints-index — derive the CI gate list from the ONE truth (pixi.toml
 * `[tasks] ci depends-on`) into CONSTRAINTS.md's `<!-- BEGIN:ci-gates -->`
 * region (plan Batch 3; RCH constraints-index shape). The task table is the
 * only source; the region is never hand-edited. Editing the region by hand =
 * drift = red on check.
 *
 * Note: pixi `depends-on` runs gates concurrently (no order guarantee), so the
 * generated list says "requires, all green" — never "in order" (RCH's list is
 * ordered because its chain is sequential; ours is not).
 */

import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import {
  ROOT, loadTargets, rewriteMarkerRegion, writeIfChanged, relRoot,
  EXIT_CLEAN, EXIT_FINDINGS,
} from "./agent-common.mts";

function parseCiDependsOn(pixiToml: string): string[] {
  // inline form: ci = { cmd = "...", depends-on = ["a", "b"] }
  const taskRe = /^ci\s*=\s*\{[^}]*\}/m;
  const task = pixiToml.match(taskRe)?.[0];
  if (!task) return [];
  const deps = task.match(/depends-on\s*=\s*\[([^\]]*)\]/)?.[1] ?? "";
  return [...deps.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function renderList(deps: string[]): string {
  if (deps.length === 0) {
    return "(generated region — placeholder; the pixi ci chain is not wired yet)";
  }
  return [
    "Generated from `pixi.toml` -> `[tasks] ci depends-on` — edit pixi.toml, not this",
    "region. `pixi run ci` requires ALL of these green (pixi runs them concurrently):",
    "",
    ...deps.map((d, i) => `${i + 1}. \`${d}\``),
  ].join("\n");
}

export function run(mode: "check" | "sync"): { code: number; summary: string } {
  const cfg = loadTargets();
  const pixiPath = path.join(ROOT, "pixi.toml");
  if (!existsSync(pixiPath)) return { code: EXIT_FINDINGS, summary: "constraints-index: pixi.toml missing" };
  const deps = parseCiDependsOn(readFileSync(pixiPath, "utf8"));
  const want = renderList(deps);

  const hubPath = path.join(ROOT, cfg.constraints_hub);
  const hubText = readFileSync(hubPath, "utf8");
  const current = hubText.match(/<!--[ \t]*BEGIN:ci-gates[ \t]*-->[\s\S]*?<!--[ \t]*END:ci-gates[ \t]*-->/)?.[0] ?? null;
  const nextRegion = `<!-- BEGIN:ci-gates -->\n${want}\n<!-- END:ci-gates -->`;

  if (mode === "sync") {
    const wrote = writeIfChanged(hubPath, rewriteMarkerRegion(hubText, "ci-gates", want));
    return { code: EXIT_CLEAN, summary: `constraints-index: ${wrote ? "region written" : "already current"} (${deps.length} gates)` };
  }
  if (current !== nextRegion) {
    console.log(`  ${relRoot(hubPath)} ci-gates region drifted (derived ${deps.length} gates from pixi.toml)`);
    console.log("  fix: node scripts/agents/agent-links.mts sync");
    return { code: EXIT_FINDINGS, summary: "constraints-index: drift" };
  }
  return { code: EXIT_CLEAN, summary: `constraints-index: clean (${deps.length} gates)` };
}

if (import.meta.main) {
  const arg = process.argv[2] ?? "check";
  if (arg !== "check" && arg !== "sync") { console.error("usage: constraints-index.mts [check|sync]"); process.exit(2); }
  process.exit(run(arg).code);
}
