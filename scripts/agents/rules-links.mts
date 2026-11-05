/**
 * rules-links — layer 1/3: .agents/rules/<lang>/<topic>.md → CodeBuddy
 * `.codebuddy/rules/<lang>-<topic>/RULE.mdc` (mdc layout, flat dirs — nested
 * layouts are not recursively discovered by the host, VE-verified).
 *
 * Plan Batch 2; alwaysApply true only for the two always-on rules (ADJ-2
 * discipline: minimal always-on surface, the rest routes by description).
 */

import { readFileSync, readdirSync, existsSync, lstatSync, realpathSync } from "node:fs";
import * as path from "node:path";
import {
  ROOT, loadTargets, guard, sha256Short, writeIfChanged, relRoot,
  EXIT_CLEAN, EXIT_FINDINGS, collectRules, type RuleFile,
} from "./agent-common.mts";


/** Strip a leading YAML frontmatter block (language-dir files carry `paths:` globs). */
function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return text;
  return text.slice(text.indexOf("\n", end + 1) + 1).replace(/^\n+/, "");
}

/** First H1 as the fallback description. */
function firstH1(text: string): string {
  const m = stripped(text).match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "(no description)";
  function stripped(t: string): string { return stripFrontmatter(t); }
}

/** Redirect relative links from the source layout to the generated flat layout. */
function redirectLinks(body: string, lang: string): string {
  return body
    // same-dir link: ](topic.md) -> ](../<lang>-<topic>/RULE.mdc)
    .replace(/\]\((?!https?:|#|\/)([a-z0-9-]+)\.md(#[^)]*)?\)/g, (_m, topic: string, hash: string) => `](../${lang}-${topic}/RULE.mdc${hash ?? ""})`)
    // cross-dir link: ](../lang/topic.md) -> ](../<lang>-<topic>/RULE.mdc)
    .replace(/\]\(\.\.\/([a-z0-9-]+)\/([a-z0-9-]+)\.md(#[^)]*)?\)/g, (_m, l: string, t: string, hash: string) => `](../${l}-${t}/RULE.mdc${hash ?? ""})`);
}

function renderMdc(rule: RuleFile, source: string, desc: string, alwaysOn: boolean): string {
  const body = redirectLinks(stripFrontmatter(source), rule.lang);
  const fm = [
    "---",
    `description: ${JSON.stringify(desc)}`,
    `alwaysApply: ${alwaysOn}`,
    "enabled: true",
    `updatedAt: ${sha256Short(source)}`,
    "---",
    "",
  ].join("\n");
  return fm + body;
}

/** Guard: the generated root must not be a symlink nor resolve inside the source tree. */
function guardTargetDir(dir: string, canonicalRoot: string): void {
  if (!existsSync(dir)) return;
  const st = lstatSync(dir);
  if (st.isSymbolicLink()) guard(`target dir ${relRoot(dir)} is itself a symlink — sync would follow it into the wrong tree`);
  const real = realpathSync(dir);
  if (real.startsWith(canonicalRoot + path.sep)) guard(`target dir ${relRoot(dir)} resolves inside the canonical tree ${relRoot(canonicalRoot)} — sync could rename or delete the single source`);
}

export function run(mode: "check" | "sync"): { code: number; summary: string } {
  const cfg = loadTargets();
  const rulesRoot = path.join(ROOT, cfg.rules_root);
  const target = cfg.targets.find((t) => t.label === "codebuddy" && t.enabled && t.rules_mode === "mdc");
  if (!target || !target.rules_dir) return { code: EXIT_CLEAN, summary: "rules-links: no enabled mdc target, skip" };

  const outDir = path.join(ROOT, target.rules_dir);
  guardTargetDir(outDir, rulesRoot);

  const rules = collectRules(rulesRoot, cfg.rules_exclude_dirs);
  const drift: string[] = [];
  let written = 0;
  for (const rule of rules) {
    const key = `${rule.lang}-${rule.topic}`;
    const source = readFileSync(rule.src, "utf8");
    const desc = cfg.rule_descriptions[key] ?? firstH1(source);
    const next = renderMdc(rule, source, desc, cfg.always_on_rules.includes(key));
    const dest = path.join(outDir, key, "RULE.mdc");
    if (mode === "sync") { if (writeIfChanged(dest, next)) written++; }
    else {
      const prev = existsSync(dest) ? readFileSync(dest, "utf8") : null;
      if (prev !== next) drift.push(relRoot(dest));
    }
  }
  // Extra generated dirs whose source is gone = drift findings (never delete on check).
  if (existsSync(outDir)) {
    for (const d of readdirSync(outDir)) {
      const [l, ...rest] = d.split("-");
      const topic = rest.join("-");
      if (!rules.some((r) => r.lang === l && r.topic === topic) && !d.startsWith(".")) drift.push(`${relRoot(outDir)}/${d} (orphan: source rule gone)`);
    }
  }
  if (mode === "sync") {
    return { code: EXIT_CLEAN, summary: `rules-links: ${rules.length} rules, ${written} written (idempotent)` };
  }
  if (drift.length > 0) {
    console.log(`rules-links: ${drift.length} drifted file(s):`);
    for (const d of drift) console.log(`  ${d}`);
    console.log("  fix: pixi run agents-sync (wired at Batch 3; today: node scripts/agents/agent-links.mts sync)");
    return { code: EXIT_FINDINGS, summary: `rules-links: ${drift.length} drift` };
  }
  return { code: EXIT_CLEAN, summary: `rules-links: clean (${rules.length} rules)` };
}
