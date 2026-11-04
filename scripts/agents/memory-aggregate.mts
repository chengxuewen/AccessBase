/**
 * memory-aggregate — layer 3/3: navigable digest of the memory files into the
 * AGENTS.md `agents-memory` marker region (VE D41 shape).
 *
 * One bullet per `## ` heading; deterministic WINDOW keeps only the latest N
 * entries per file plus an omitted-pointer line (ADJ-2b ruling A: decisions 25
 * / pitfalls 15 / status 6). The window is deterministic, so gate comparison
 * stays byte-stable. Duplicate numbers (concurrent numbering collisions) are a
 * hard finding. Hub budget checked by the dispatcher after sync/check.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  ROOT, loadTargets, rewriteMarkerRegion, writeIfChanged, relRoot,
  EXIT_CLEAN, EXIT_FINDINGS,
} from "./agent-common.mts";

const WINDOW = { decisions: 25, pitfalls: 15, status: 6 } as const;

interface Entry { title: string; num: string | null; }

function parseHeadings(file: string, numRe: RegExp | null): Entry[] {
  const out: Entry[] = [];
  for (const m of file.matchAll(/^##\s+(.+)$/gm)) {
    const title = m[1].trim();
    const num = numRe ? (title.match(numRe)?.[1] ?? null) : null;
    out.push({ title, num });
  }
  return out;
}

function duplicateNumbers(entries: Entry[], kind: string, file: string): string[] {
  const seen = new Map<string, number>();
  const dup: string[] = [];
  for (const e of entries) {
    if (!e.num) continue;
    const c = (seen.get(e.num) ?? 0) + 1;
    seen.set(e.num, c);
    if (c === 2) dup.push(`${file}: ${kind} number ${e.num} defined more than once — concurrent numbering collision`);
  }
  return dup;
}

function section(entries: Entry[], keep: number): string[] {
  const omitted = Math.max(0, entries.length - keep);
  const rows = entries.slice(-keep).map((e) => `- ${e.title}`);
  const head = omitted > 0 ? [`... ${omitted} older entries omitted (read the full file)`] : [];
  return [...head, ...rows];
}

export function renderDigest(memorysRoot: string): { digest: string; findings: string[] } {
  const dec = parseHeadings(readFileSync(path.join(memorysRoot, "decisions.md"), "utf8"), /^D(\d+):/);
  const pit = parseHeadings(readFileSync(path.join(memorysRoot, "pitfalls.md"), "utf8"), /^PIT-(\d+):/);
  const stat = parseHeadings(readFileSync(path.join(memorysRoot, "status.md"), "utf8"), null);
  const findings = [
    ...duplicateNumbers(dec, "D", "decisions.md"),
    ...duplicateNumbers(pit, "PIT", "pitfalls.md"),
  ];
  const digest = [
    "Navigable digest — one bullet per entry; full text in `.agents/memorys/*.md`,",
    "read on demand. Maintained by `agents sync`; do not hand-edit this region.",
    "",
    "### decisions",
    "- full text: `.agents/memorys/decisions.md`",
    ...section(dec, WINDOW.decisions),
    "",
    "### pitfalls",
    "- full text: `.agents/memorys/pitfalls.md`",
    ...section(pit, WINDOW.pitfalls),
    "",
    "### status",
    "- full text: `.agents/memorys/status.md`",
    ...section(stat, WINDOW.status),
  ].join("\n");
  return { digest, findings };
}

export function run(mode: "check" | "sync"): { code: number; summary: string } {
  const cfg = loadTargets();
  const memorysRoot = path.join(ROOT, cfg.memorys_root);
  const hubPath = path.join(ROOT, cfg.memory_hub);
  const hubText = readFileSync(hubPath, "utf8");
  const { digest, findings } = renderDigest(memorysRoot);

  const nextRegion = `<!-- BEGIN:agents-memory -->\n${digest}\n<!-- END:agents-memory -->`;
  const current = hubText.match(/<!--[ \t]*BEGIN:agents-memory[ \t]*-->[\s\S]*?<!--[ \t]*END:agents-memory[ \t]*-->/)?.[0] ?? null;

  if (mode === "sync") {
    const wrote = writeIfChanged(hubPath, rewriteMarkerRegion(hubText, "agents-memory", digest));
    return {
      code: findings.length ? EXIT_FINDINGS : EXIT_CLEAN,
      summary: `memory-aggregate: ${wrote ? "region written" : "already current"}${findings.length ? `, ${findings.length} finding(s)` : ""}`,
    };
  }
  if (findings.length || current !== nextRegion) {
    if (current !== nextRegion) console.log(`  ${relRoot(hubPath)} agents-memory region drifted`);
    for (const f of findings) console.log(`  ${f}`);
    console.log("  fix: node scripts/agents/agent-links.mts sync");
    return { code: EXIT_FINDINGS, summary: `memory-aggregate: ${findings.length + (current !== nextRegion ? 1 : 0)} finding(s)` };
  }
  return { code: EXIT_CLEAN, summary: "memory-aggregate: clean" };
}
