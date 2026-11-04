/**
 * skill-lint — skill hygiene layer (plan Batch 3). 8-point check over every
 * `.agents/skills/<name>/SKILL.md`:
 *
 *   1. every skill dir has a SKILL.md
 *   2. frontmatter `name` present and matches the directory name
 *   3. `description` present and >= 20 chars
 *   4. description carries a routing trigger (Use when/for/before, 使用, 适用于…)
 *   5. `status: inoperative` => description MUST hard-prefix "INOPERATIVE"
 *      (RCH discipline: keep the directory, kill the routing, mark loudly)
 *   6. no duplicate skill names
 *   7. AGENTS.md skills-directory region matches frontmatter (digest drift)
 *   8. C/D/PIT citations in the skill body resolve (reuses rule-ref-lint core;
 *      MS:/VE:/RCH: prefixes exempt, ADJ-1b)
 *
 * Read-only. Exit via the layer protocol (0/1). CLI: node skill-lint.mts [check]
 */

import { readFileSync, readdirSync, existsSync, lstatSync } from "node:fs";
import * as path from "node:path";
import { ROOT, loadTargets, parseFrontmatter, EXIT_CLEAN, EXIT_FINDINGS } from "./agent-common.mts";
import { collectDefs, scanTextForDangling } from "./rule-ref-lint.mts";

interface Skill { dirName: string; name: string; description: string; status?: string; file: string; body: string; }

const TRIGGER = /(use (when|for|before|after)|使用|适用于|自动激活|触发)/i;

/** Collect rule file basenames (no extension) for `rule:<name>` reference resolution. */
function collectRuleNames(rulesRoot: string, exclude: string[]): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (exclude.includes(entry)) continue;
      const full = path.join(dir, entry);
      if (lstatSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) out.add(entry.replace(/\.md$/, ""));
    }
  };
  walk(rulesRoot);
  return out;
}

export function run(_mode: "check" | "sync"): { code: number; summary: string } {
  const cfg = loadTargets();
  const skillsRoot = path.join(ROOT, cfg.skills_root);
  const findings: string[] = [];
  const skills: Skill[] = [];

  for (const dirName of readdirSync(skillsRoot)) {
    const dir = path.join(skillsRoot, dirName);
    if (!lstatSync(dir).isDirectory()) continue;
    const file = path.join(dir, "SKILL.md");
    if (!existsSync(file)) { findings.push(`${dirName}/: no SKILL.md`); continue; }
    const { fm, body } = parseFrontmatter(readFileSync(file, "utf8"));
    const s: Skill = {
      dirName, name: fm.name ?? "", description: fm.description ?? "",
      status: fm.status, file, body,
    };
    skills.push(s);
    // point 2
    if (!s.name) findings.push(`${dirName}/: frontmatter "name" missing`);
    else if (s.name !== dirName) findings.push(`${dirName}/: name "${s.name}" != directory name`);
    // point 3
    if ([...s.description].length < 20) findings.push(`${dirName}/: description too short (<20 chars) or missing`);
    // point 4
    else if (!TRIGGER.test(s.description)) findings.push(`${dirName}/: description lacks a routing trigger (Use when/for/before, 使用, 适用于…)`);
    // point 5
    if (s.status === "inoperative" && !/^INOPERATIVE/i.test(s.description)) {
      findings.push(`${dirName}/: status inoperative but description does not hard-prefix "INOPERATIVE — do not route here"`);
    }
  }

  // point 6
  const names = skills.map((s) => s.name || s.dirName);
  for (const n of new Set(names)) {
    if (names.filter((x) => x === n).length > 1) findings.push(`duplicate skill name "${n}"`);
  }

  // point 7 — digest drift (registry region must equal frontmatter-derived rows)
  const hub = readFileSync(path.join(ROOT, cfg.memory_hub), "utf8");
  const region = hub.match(/<!--[ \t]*BEGIN:skills-directory[ \t]*-->[\s\S]*?<!--[ \t]*END:skills-directory[ \t]*-->/)?.[0] ?? null;
  if (!region) findings.push(`${cfg.memory_hub}: skills-directory region absent (run agents sync)`);
  else {
    for (const s of skills) {
      if (!region.includes(`\`${s.name || s.dirName}\``)) {
        findings.push(`${cfg.memory_hub}: skills-directory region missing row for "${s.name || s.dirName}" (drift)`);
      }
    }
  }

  // point 8 — C/D/PIT citations resolve
  const defs = collectDefs(path.join(ROOT, cfg.memorys_root));
  for (const s of skills) {
    for (const f of scanTextForDangling(s.body, defs, `${s.dirName}/SKILL.md`)) findings.push(f);
  }

  // point 9 — explicit cross-references resolve: `skill:<name>` must exist as a
  // skill directory, `rule:<name>` as a rules-tree file; `plugin:<name>` is an
  // explicit external declaration (exempt). Legacy un-prefixed backtick mentions
  // are not checked (progressive syntax; new writes use the prefixes).
  const skillNames = new Set(skills.map((s) => s.name || s.dirName));
  const ruleNames = collectRuleNames(path.join(ROOT, cfg.rules_root), cfg.rules_exclude_dirs);
  for (const s of skills) {
    for (const m of s.body.matchAll(/`(skill|rule|plugin):([a-z0-9-]+)`/g)) {
      const kind = m[1] as "skill" | "rule" | "plugin";
      const ref = m[2];
      if (kind === "plugin") continue;
      if (kind === "skill" && !skillNames.has(ref)) {
        findings.push(`${s.dirName}/SKILL.md — \`skill:${ref}\` references a skill that does not exist here (migrated residue? use \`plugin:${ref}\` for external plugin skills)`);
      }
      if (kind === "rule" && !ruleNames.has(ref)) {
        findings.push(`${s.dirName}/SKILL.md — \`rule:${ref}\` references a rule file that does not exist under ${cfg.rules_root}`);
      }
    }
  }

  if (findings.length) {
    console.log(`skill-lint: ${findings.length} finding(s):`);
    for (const f of findings) console.log(`  ${f}`);
    console.log("  fix: correct the SKILL.md frontmatter/body, then node scripts/agents/agent-links.mts sync");
    return { code: EXIT_FINDINGS, summary: `skill-lint: ${findings.length} finding(s)` };
  }
  return { code: EXIT_CLEAN, summary: `skill-lint: clean (${skills.length} skills, 9 checks each)` };
}

if (import.meta.main) {
  const arg = process.argv[2] ?? "check";
  if (arg !== "check") { console.error("usage: skill-lint.mts [check]"); process.exit(2); }
  process.exit(run("check").code);
}
