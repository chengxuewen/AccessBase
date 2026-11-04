/**
 * agent-common — shared base for the per-layer generators (plan 2026-11-04
 * Batch 2; VE agent_common pattern, re-derived for this repo's TS stack).
 *
 * Conventions exported to every layer:
 *   - Exit codes: 0 clean / 1 findings / 2 guard violation (nothing written;
 *     protects the single source from being renamed or deleted by its own sync).
 *   - Marker regions: BEGIN/END must each appear EXACTLY once. Duplicates or a
 *     half-present pair mean a previous rewrite leaked — refuse to stack
 *     corruption (VE PIT-84 lesson): exit 2 before writing anything.
 *   - Hub budget: dual-unit (chars + bytes — CJK splits the two), hard cap and
 *     warn threshold from agent-targets.json (ADJ-2b: 30000 / 28500).
 *   - Content fingerprints: updatedAt = sha256(canonical)[:12] — timestamps
 *     would redden every sync.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_GUARD = 2;

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const TARGETS_PATH = path.join(ROOT, "scripts", "agents", "agent-targets.json");

export interface Targets {
  rules_root: string;
  skills_root: string;
  memorys_root: string;
  memory_hub: string;
  constraints_hub: string;
  generated_tracked: string[];
  rules_exclude_dirs: string[];
  always_on_rules: string[];
  rule_descriptions: Record<string, string>;
  hub_budget: { hard: number; warn: number };
  targets: Array<{
    label: string;
    enabled: boolean;
    rules_dir?: string;
    rules_mode?: string;
    skills_dir?: string;
    gitignored?: boolean;
    note?: string;
  }>;
}

export function loadTargets(): Targets {
  return JSON.parse(readFileSync(TARGETS_PATH, "utf8")) as Targets;
}

/** Guard: print reason and abort with nothing written. */
export function guard(reason: string): never {
  console.error(`guard: ${reason}`);
  console.error("guard: refusing to write anything (exit 2)");
  process.exit(EXIT_GUARD);
}

// --- frontmatter -----------------------------------------------------------

/**
 * Minimal YAML frontmatter parser: single-line scalars PLUS folded/literal
 * block scalars (`>-`, `|-`, `>`, `|`) — descriptions use them for long text.
 * Returns { fm, body }: fm maps keys to strings; body is post-frontmatter.
 */
export function parseFrontmatter(text: string): { fm: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { fm: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { fm: {}, body: text };
  const lines = text.slice(3, end).split("\n");
  const fm: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const rest = m[2];
    if (rest === ">-" || rest === "-" || rest === ">" || rest === "|" || rest === "|-") {
      const buf: string[] = [];
      let j = i + 1;
      while (j < lines.length && (lines[j] === "" || /^\s/.test(lines[j]))) {
        buf.push(lines[j].replace(/^\s+/, ""));
        j++;
      }
      fm[key] = buf.join(rest.startsWith(">") ? " " : "\n").trim();
      i = j - 1;
    } else {
      fm[key] = rest.replace(/^['"]|['"]$/g, "");
    }
  }
  return { fm, body: text.slice(end + 4) };
}

// --- marker regions -------------------------------------------------------

export interface MarkerRegion {
  beginIndex: number;
  endIndex: number; // index just past the END line
  inner: string; // content between the marker lines (trimmed bounds preserved)
}

const MARKER_RE = (name: string) =>
  new RegExp(`<!--[ \\t]*BEGIN:${name}[ \\t]*-->[\\s\\S]*?<!--[ \\t]*END:${name}[ \\t]*-->`, "g");

/**
 * Validate pairing: BEGIN and END each exactly once. Half-present or duplicated
 * -> guard (a declared-but-broken region is corruption, not a missing region).
 */
export function validateMarkerPair(text: string, name: string): void {
  const begins = (text.match(new RegExp(`<!--[ \\t]*BEGIN:${name}[ \\t]*-->`, "g")) ?? []).length;
  const ends = (text.match(new RegExp(`<!--[ \\t]*END:${name}[ \\t]*-->`, "g")) ?? []).length;
  if (begins === 0 && ends === 0) return; // absent = appendable, legal
  if (begins === 1 && ends === 1) return; // healthy
  guard(
    `marker region "${name}" is corrupt: ${begins} BEGIN / ${ends} END ` +
      `(must be 1/1 or 0/0 — a leaked rewrite stacked duplicates, VE PIT-84)`,
  );
}

/** Rewrite (or append at EOF when absent) a marker region. Non-destructive to
 *  everything outside the region. */
export function rewriteMarkerRegion(text: string, name: string, newInner: string): string {
  validateMarkerPair(text, name);
  const region = `<!-- BEGIN:${name} -->\n${newInner}\n<!-- END:${name} -->`;
  const re = MARKER_RE(name);
  if (re.test(text)) return text.replace(re, () => region); // fresh regex (lastIndex)
  const trimmed = text.endsWith("\n") ? text : text + "\n";
  return trimmed + region + "\n";
}

/** Extract the current inner content of a marker region (null when absent). */
export function readMarkerRegion(text: string, name: string): string | null {
  validateMarkerPair(text, name);
  const m = text.match(MARKER_RE(name));
  if (!m) return null;
  return m[0]
    .replace(new RegExp(`^[\\s\\S]*?<!--[ \\t]*BEGIN:${name}[ \\t]*-->\\n?`), "")
    .replace(new RegExp(`\\n?<!--[ \\t]*END:${name}[ \\t]*-->[\\s\\S]*?$`), "");
}

// --- hub budget -----------------------------------------------------------

export interface BudgetReport {
  chars: number;
  bytes: number;
  hard: number;
  warn: number;
  over: boolean; // exceeds hard cap in EITHER unit
  near: boolean; // exceeds warn in either unit
}

export function hubBudget(text: string, cfg: { hard: number; warn: number }): BudgetReport {
  const chars = [...text].length;
  const bytes = Buffer.byteLength(text, "utf8");
  return {
    chars,
    bytes,
    hard: cfg.hard,
    warn: cfg.warn,
    over: chars > cfg.hard || bytes > cfg.hard,
    near: chars > cfg.warn || bytes > cfg.warn,
  };
}

// --- misc -----------------------------------------------------------------

export function sha256Short(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 12);
}

/** Idempotent write: only touches disk when content differs. Returns true when written. */
export function writeIfChanged(filePath: string, next: string): boolean {
  const prev = existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
  if (prev === next) return false;
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, next, "utf8");
  return true;
}

export function relRoot(p: string): string {
  return path.relative(ROOT, p);
}
