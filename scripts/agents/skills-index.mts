/**
 * skills-index — layer 2/3: two faces of the skills single source.
 *   1. Registry digest: the AGENTS.md `skills-directory` marker region (ADJ-2c
 *      ruling B: NO root SKILL.md — this marker region is the only registry).
 *      Row content comes from frontmatter ONLY (ADJ-7a: unpack `{ fm, body }` — a
 *      mis-unpack silently rendered every Purpose cell empty while `check` stayed
 *      green, because the drift assertion matched names, not content). `|` inside a
 *      description is escaped so one cell can never split the table.
 *      Region ordering rule (VE D47/B4): skills-directory MUST precede
 *      agents-memory (hosts truncate long files from the tail).
 *   2. Host activation: `.codebuddy/skills/<name>` as RELATIVE symlinks into
 *      `.agents/skills/<name>` (ADJ-2d ruling A: per-machine, gitignored).
 *      Classification: ok / missing / dangling / exists (shadow) /
 *      wrong-target / extra-link. Shadows are backup-then-linked, never
 *      silently overwritten; orphans are backed up and pruned (.bak-<ts>,
 *      keep 5).
 */

import { readFileSync, readdirSync, existsSync, lstatSync, readlinkSync, symlinkSync, renameSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import {
  ROOT, loadTargets, guard, parseFrontmatter, rewriteMarkerRegion, writeIfChanged, relRoot,
  EXIT_CLEAN, EXIT_FINDINGS,
} from "./agent-common.mts";

const DESC_LIMIT = 45;

interface SkillMeta { name: string; description: string; status?: string; dir: string; }

function collectSkills(skillsRoot: string): SkillMeta[] {
  const out: SkillMeta[] = [];
  for (const name of readdirSync(skillsRoot)) {
    const dir = path.join(skillsRoot, name);
    if (!lstatSync(dir).isDirectory()) continue;
    const skillFile = path.join(dir, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const { fm } = parseFrontmatter(readFileSync(skillFile, "utf8"));
    out.push({ name: fm.name ?? name, description: fm.description ?? "", status: fm.status, dir });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function clip(s: string, n: number): string {
  return [...s].length <= n ? s : [...s].slice(0, n - 1).join("") + "…";
}

/** Keep one description from splitting the digest table (ADJ-7a). */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderDigest(skills: SkillMeta[]): string {
  const rows = skills.map((s) => {
    const flag = s.status === "inoperative" ? " *(inoperative — do not route here)*" : "";
    return `| \`${s.name}\` | ${cell(clip(s.description, DESC_LIMIT))}${flag} |`;
  });
  return [
    "Skills single source: `.agents/skills/*/SKILL.md`; routing surface = each",
    "frontmatter `description`. Maintained by `agents sync` — do not hand-edit this region.",
    "",
    "| Skill | Purpose |",
    "|---|---|",
    ...rows,
  ].join("\n");
}

// --- symlink activation layer ----------------------------------------------

const KEEP_BACKUPS = 5;

function rotateBackup(target: string): void {
  const ts = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  renameSync(target, `${target}.bak-${ts}`);
  const parent = path.dirname(target);
  const prefix = path.basename(target) + ".bak-";
  const baks = readdirSync(parent).filter((f) => f.startsWith(prefix)).sort();
  while (baks.length > KEEP_BACKUPS) rmSync(path.join(parent, baks.shift() as string), { recursive: true });
}

function classifyLink(linkPath: string, expectedTarget: string): "ok" | "wrong-target" | "dangling" {
  const st = lstatSync(linkPath);
  if (!st.isSymbolicLink()) return "wrong-target"; // a real dir squatting the name
  const raw = readlinkSync(linkPath);
  if (path.isAbsolute(raw)) return "wrong-target";
  const resolved = path.resolve(path.dirname(linkPath), raw);
  if (resolved !== expectedTarget) return "wrong-target";
  return existsSync(resolved) ? "ok" : "dangling";
}

export function run(mode: "check" | "sync"): { code: number; summary: string } {
  const cfg = loadTargets();
  const skillsRoot = path.join(ROOT, cfg.skills_root);
  const skills = collectSkills(skillsRoot);
  const names = skills.map((s) => s.name);
  if (new Set(names).size !== names.length) guard("duplicate skill names in canonical root");
  if (skills.length === 0) guard("canonical skills root is empty — refusing to wipe the activation layer");

  const findings: string[] = [];
  let wrote = 0;

  // --- face 1: registry digest into the memory hub -------------------------
  const hubPath = path.join(ROOT, cfg.memory_hub);
  const hubText = readFileSync(hubPath, "utf8");
  const wantDigest = renderDigest(skills);
  const currentDigest = /<!--[ \t]*BEGIN:skills-directory[ \t]*-->/.test(hubText);
  if (currentDigest) {
    const before = hubText.match(/<!--[ \t]*BEGIN:skills-directory[ \t]*-->[\s\S]*?<!--[ \t]*END:skills-directory[ \t]*-->/)?.[0] ?? "";
    const nextRegion = `<!-- BEGIN:skills-directory -->\n${wantDigest}\n<!-- END:skills-directory -->`;
    if (mode === "sync") {
      if (writeIfChanged(hubPath, rewriteMarkerRegion(hubText, "skills-directory", wantDigest))) wrote++;
    } else if (before !== nextRegion) findings.push(`${relRoot(hubPath)} skills-directory region drifted`);
  } else if (mode === "sync") {
    if (writeIfChanged(hubPath, rewriteMarkerRegion(hubText, "skills-directory", wantDigest))) wrote++;
  } else {
    findings.push(`${relRoot(hubPath)} has no skills-directory region (sync appends it)`);
  }

  // Region ordering: skills-directory must precede agents-memory (VE D47/B4).
  const hubAfter = mode === "sync" ? readFileSync(hubPath, "utf8") : hubText;
  const iSkills = hubAfter.search(/<!--[ \t]*BEGIN:skills-directory/);
  const iMemory = hubAfter.search(/<!--[ \t]*BEGIN:agents-memory/);
  if (iSkills !== -1 && iMemory !== -1 && iSkills > iMemory) {
    findings.push(`${relRoot(hubPath)} region order wrong: skills-directory must precede agents-memory (hosts truncate from the tail)`);
  }

  // --- face 2: symlink activation layer ------------------------------------
  const target = cfg.targets.find((t) => t.label === "codebuddy" && t.enabled && t.skills_dir);
  // ADJ-7f: symlink face is per-machine/gitignored — CI skips it (yellow, never exit code)
  if (target?.skills_dir && target.gitignored && process.env.CI) {
    console.log("skills-index: CI skip for symlink face (gitignored per-machine face — rebuilt by agents sync locally)");
  } else if (target?.skills_dir) {
    const actDir = path.join(ROOT, target.skills_dir);
    // ADJ-7f: check is honestly read-only — only sync may create the dir
    const dirExists = existsSync(actDir);
    if (!dirExists && mode === "sync") mkdirSync(actDir, { recursive: true });
    const byExpected = new Map(skills.map((s) => [path.resolve(actDir, s.name), s.name]));
    for (const s of skills) {
      const linkPath = path.join(actDir, s.name);
      const expected = path.resolve(skillsRoot, s.name);
      const rel = path.relative(actDir, expected); // relative link target
      let st: ReturnType<typeof lstatSync> | null = null;
      try { st = lstatSync(linkPath); } catch { /* not present */ }
      if (!st) {
        // missing
        if (mode === "sync") { symlinkSync(rel, linkPath, "dir"); wrote++; }
        else findings.push(`${relRoot(linkPath)} missing`);
      } else {
        const cls = classifyLink(linkPath, expected);
        if (cls === "ok") continue;
        if (mode === "sync") {
          rotateBackup(linkPath); // shadow or wrong link: backup, never overwrite silently
          symlinkSync(rel, linkPath, "dir"); wrote++;
          findings.push(`${relRoot(linkPath)} ${cls} — replaced (backup kept)`);
        } else findings.push(`${relRoot(linkPath)} ${cls}`);
      }
    }
    // orphan links (skill gone from canonical)
    // orphan scan only when the dir exists (check stays read-only, ADJ-7f)
    if (dirExists) for (const entry of readdirSync(actDir)) {
      if (entry.startsWith(".")) continue;
      const p = path.join(actDir, entry);
      if (!byExpected.has(path.resolve(actDir, entry)) && !entry.includes(".bak-")) {
        if (mode === "sync") { rotateBackup(p); findings.push(`${relRoot(p)} orphan — backed up and pruned`); }
        else findings.push(`${relRoot(p)} orphan link (source skill gone)`);
      }
    }
  }

  if (mode === "sync") {
    const still = findings.filter((f) => !f.includes("replaced") && !f.includes("pruned"));
    return { code: still.length ? EXIT_FINDINGS : EXIT_CLEAN, summary: `skills-index: ${skills.length} skills, ${wrote} writes${still.length ? `, ${still.length} finding(s) remain` : ""}` };
  }
  if (findings.length) {
    console.log(`skills-index: ${findings.length} finding(s):`);
    for (const f of findings) console.log(`  ${f}`);
    console.log("  fix: node scripts/agents/agent-links.mts sync");
    return { code: EXIT_FINDINGS, summary: `skills-index: ${findings.length} finding(s)` };
  }
  return { code: EXIT_CLEAN, summary: `skills-index: clean (${skills.length} skills)` };
}
